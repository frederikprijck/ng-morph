import { NgAstNode } from '../ng-ast-node'
import { Project } from '../../../project'
import { LocationSpan } from '../location'
import { Template } from './template'
import {
  isBananaInTheBox,
  isBoundAttribute,
  isBoundEvent,
  isReference,
  isTextAttribute,
} from './template-nodes-type-guards'
import { getFirstElementOrThrow, getLastElementOrThrow, Predicate, TapFn, throwIfUndefined } from '../../../utils'
import { getTokenTypeName, Token, TokenType } from './tokenizer/lexer'

export interface TextReplaceConfig {
  token: Token
  newText: string
}

export abstract class TemplateNode extends NgAstNode {

  private parentTemplateNode?: TemplateNode
  private readonly template: Template
  private readonly tokens: Token[]

  protected constructor (
    project: Project,
    locationSpan: LocationSpan,
    tokens: Token[],
    template: Template,
  ) {
    super(project, locationSpan)
    this.tokens = tokens
    this.template = template
  }

  public abstract getTemplateChildren (): TemplateNode[]

  public setTemplateParent (templateParent: TemplateNode): void {
    this.parentTemplateNode = templateParent
  }

  public getTemplateParent (): TemplateNode | undefined {
    return this.parentTemplateNode
  }

  public getTemplate (): Template {
    return this.template
  }

  public getNextTemplateSibling (): TemplateNode | undefined {
    const parent = this.getTemplateParent()
    if (parent != null) {
      const children = parent.getTemplateChildren()
      const index = children.findIndex(child => child == this)
      if (index == -1) throw new Error(`Expected to have found self in parent's children.`)
      const nextIndex = index + 1
      return children[nextIndex]
    } else {
      const parent = this.getTemplate()
      const children = parent.getRoots()
      const index = children.findIndex(child => child == this as any)
      if (index == -1) throw new Error(`Expected to have found self (root) in template's roots.`)
      const nextIndex = index + 1
      return children[nextIndex]
    }
  }

  public getNextTemplateSiblingOrThrow (): TemplateNode {
    return throwIfUndefined(this.getNextTemplateSibling(), `Expected to have found the next sibling.`)
  }

  public getDescendants<T extends TemplateNode> (guard: (tNode: TemplateNode) => tNode is T): T[]
  public getDescendants (predicate: Predicate<TemplateNode>): TemplateNode[]
  public getDescendants (): TemplateNode[]
  public getDescendants (predicate?: Predicate<TemplateNode>): TemplateNode[] {
    const result: TemplateNode[] = []
    const queue: TemplateNode[] = [...this.getTemplateChildren()]
    while (queue.length > 0) {
      const node = queue.shift()!
      queue.push(...node.getTemplateChildren())
      if (predicate != null && predicate(node)) {
        result.push(node)
      }
    }
    return result
  }

  public getDescendant<T extends TemplateNode> (guard: (tNode: TemplateNode) => tNode is T): T | undefined
  public getDescendant (predicate: Predicate<TemplateNode> | undefined): TemplateNode | undefined
  public getDescendant (): TemplateNode | undefined
  public getDescendant (predicate?: Predicate<TemplateNode>): TemplateNode | undefined {
    const queue: TemplateNode[] = [...this.getTemplateChildren()]
    while (queue.length > 0) {
      const node = queue.shift()!
      queue.push(...node.getTemplateChildren())
      if (predicate != null && predicate(node)) {
        return node
      }
    }
    return undefined
  }

  public getDescendantOrThrow<T extends TemplateNode> (guard: (tNode: TemplateNode) => tNode is T): T
  public getDescendantOrThrow (predicate?: Predicate<TemplateNode> | undefined): TemplateNode
  public getDescendantOrThrow (): TemplateNode
  public getDescendantOrThrow (predicate?: Predicate<TemplateNode>): TemplateNode {
    return throwIfUndefined(this.getDescendant(predicate), `Expected to find a descendant of kind.`)
  }

  protected _replaceTextByTokens (textReplaceConfigs: Iterable<TextReplaceConfig>) {
    for (const { token, newText } of textReplaceConfigs) {
      const diff = newText.length - token.locationSpan.getLength()
      token.locationSpan.replaceText(newText)
      this.getTemplate()._forEachTokenAfter(token, token => {
        token.locationSpan.moveBy(diff)
      }, { inclusive: false })
    }
  }

  protected getTokens<T extends Token> (guard: (token: Token) => token is T): T[]
  protected getTokens (predicate: Predicate<Token>): Token[]
  protected getTokens (): Token[]
  protected getTokens (predicate?: Predicate<Token>): Token[] {
    return predicate == null
      ? this.tokens
      : this.tokens.filter(predicate)
  }

  protected getFirstTokenOfType<Type extends TokenType> (type: Type): Token<Type> | undefined {
    return this.tokens.find(token => token.type == type)
  }

  protected getFirstTokenOfTypeOrThrow<Type extends TokenType> (type: Type): Token<Type> {
    const result = this.getFirstTokenOfType(type)
    return throwIfUndefined(result, [
      `Expected to find ${getTokenTypeName(type)} `,
      `among tokens for ${this.constructor.name}: `,
      `${this.tokens.map(token => token.typeName).join(', ') || `(tokens array is empty)`}.`,
    ].join(''))
  }

  protected getFirstTokenIndex (): number {
    const firstToken = getFirstElementOrThrow(this.tokens, `The tokens array is empty.`)
    const template = this.getTemplate()
    return template.getTokenIndex(firstToken)
  }

  protected forEachTokenAfterHere (fn: TapFn<Token>) {
    const lastToken = getLastElementOrThrow(this.tokens, `The tokens array is empty.`)
    const template = this.getTemplate()
    template._forEachTokenAfter(lastToken, fn, { inclusive: false })
  }

  protected forEachTokenHere (fn: TapFn<Token>) {
    const firstToken = getFirstElementOrThrow(this.tokens, `The tokens array is empty.`)
    const lastToken = getLastElementOrThrow(this.tokens, `The tokens array is empty.`)
    const template = this.getTemplate()
    template._forEachTokenBetween(firstToken, lastToken, fn, { inclusiveStart: true, inclusiveEnd: true })
  }

  protected forEachTokenHereAndAfterHere (fn: TapFn<Token>) {
    this.forEachTokenHere(fn)
    this.forEachTokenAfterHere(fn)
  }

}


// region Text and interpolation

export class TextTemplateNode extends TemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected text: string) {
    super(project, locationSpan, tokens, template)
  }

  public getText (): string {
    return this.text
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class InterpolationTemplateNode extends TemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected text: string) {
    super(project, locationSpan, tokens, template)
  }

  public getTextToken () {
    return this.getFirstTokenOfTypeOrThrow(TokenType.TEXT)
  }

  public getText (): string {
    return this.getTextToken().toString()
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

  public changeText (newText: string): this {
    this._replaceTextByTokens([
      { token: this.getTextToken(), newText },
    ])
    return this
  }

  public trimText (): this {
    const trimmedText = this.getText().trim()
    return this.changeText(trimmedText)
  }


}

// endregion Text and interpolation

// region Elements, ng-template and ng-container

type AnyAttribute =
  TextAttributeTemplateNode
  | BoundAttributeTemplateNode
  | BoundEventTemplateNode
  | BananaInTheBoxTemplateNode
  | ReferenceTemplateNode

export abstract class ElementLikeTemplateNode extends TemplateNode {

  protected textAttributes: TextAttributeTemplateNode[] = []
  protected boundAttributes: BoundAttributeTemplateNode[] = []
  protected boundEvents: BoundEventTemplateNode[] = []
  protected bananaInTheBoxes: BananaInTheBoxTemplateNode[] = []
  protected references: ReferenceTemplateNode[] = []

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected allAttributes: Array<AnyAttribute>,
                      protected children: TemplateNode[]) {
    super(project, locationSpan, tokens, template)

    for (const attribute of allAttributes) {
      if (isTextAttribute(attribute)) this.textAttributes.push(attribute)
      else if (isBoundAttribute(attribute)) this.boundAttributes.push(attribute)
      else if (isBoundEvent(attribute)) this.boundEvents.push(attribute)
      else if (isBananaInTheBox(attribute)) this.bananaInTheBoxes.push(attribute)
      else if (isReference(attribute)) this.references.push(attribute)
      else throw new Error(`Unexpected type of attribute ${(attribute as any).constructor.name}.`)
    }
  }

  public getTemplateChildren (): TemplateNode[] {
    return this.children
  }

  public abstract getTagName (): string

  public getTagOpenStartToken (): Token<TokenType.TAG_OPEN_START> {
    return this.getFirstTokenOfTypeOrThrow(TokenType.TAG_OPEN_START)
  }

  public getTagEndToken (): Token<TokenType.TAG_CLOSE> {
    return this.getFirstTokenOfTypeOrThrow(TokenType.TAG_CLOSE)
  }

  public getStartTagNameLocationSpan (): LocationSpan {
    const token = this.getTagOpenStartToken()
    return token.locationSpan.clone().moveStartBy(1) // leading "<"
  }

  public getEndTagNameLocationSpan (): LocationSpan {
    const token = this.getTagEndToken()
    return token.locationSpan.clone().moveEndBy(-1) // trailing ">"
  }

  public getAttributes<T extends AttributeTemplateNode> (guard: (attr: AttributeTemplateNode) => attr is T): T[]
  public getAttributes (predicate?: Predicate<AttributeTemplateNode> | undefined): AttributeTemplateNode[]
  public getAttributes (predicate?: Predicate<AttributeTemplateNode>): AttributeTemplateNode[] {
    return predicate == null
      ? this.allAttributes
      : this.allAttributes.filter(predicate)
  }

  public getFirstAttribute<T extends AttributeTemplateNode> (guard: (attr: AttributeTemplateNode) => attr is T): T | undefined
  public getFirstAttribute (predicate?: Predicate<AttributeTemplateNode> | undefined): AttributeTemplateNode | undefined
  public getFirstAttribute (predicate?: Predicate<AttributeTemplateNode>): AttributeTemplateNode | undefined {
    return predicate == null
      ? this.allAttributes[0]
      : this.allAttributes.find(predicate)
  }

  public getFirstAttributeOrThrow<T extends AttributeTemplateNode> (guard: (attr: AttributeTemplateNode) => attr is T): T
  public getFirstAttributeOrThrow (predicate?: Predicate<AttributeTemplateNode> | undefined): AttributeTemplateNode
  public getFirstAttributeOrThrow (predicate?: Predicate<AttributeTemplateNode>): AttributeTemplateNode {
    return throwIfUndefined(this.getFirstAttribute(predicate), `Expected to find an attribute.`)
  }

  public getReferenceNamed (referenceName: string): ReferenceTemplateNode | undefined {
    return this.references.find(reference => reference.getName() == referenceName)
  }

  public getReferenceNamedOrThrow (referenceName: string): ReferenceTemplateNode {
    const position = this.getLocationSpan().printLong()
    const knownReferences = this.getAttributes(isReference).map(ref => ref.getName()).join(', ') || '(none)'
    const error = [
      `Expected element-like node at ${position} to have a reference named "${referenceName}". `,
      `These references were found: ${knownReferences}.`,
    ].join('')
    return throwIfUndefined(this.getReferenceNamed(referenceName), error)
  }

  public hasReferenceNamed (referenceName: string): boolean {
    return this.getReferenceNamed(referenceName) != null
  }

}

export class ElementTemplateNode extends ElementLikeTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected tagName: string,
                      allAttributes: Array<AnyAttribute>,
                      children: TemplateNode[]) {
    super(project, locationSpan, tokens, template, allAttributes, children)
  }

  public getTagName (): string {
    return this.getStartTagNameLocationSpan().getText()
  }

  public hasTagName (tagName: string): boolean {
    return this.getTagName() == tagName
  }

  public changeTagName (newTagName: string): this {
    this._replaceTextByTokens([
      { token: this.getTagOpenStartToken(), newText: '<' + newTagName },
      { token: this.getTagEndToken(), newText: '</' + newTagName + '>' },
    ])
    return this
  }

}

export class NgTemplateTemplateNode extends ElementLikeTemplateNode {

  public getTagName (): string {
    return `ng-template`
  }

}

export class NgContainerTemplateNode extends ElementLikeTemplateNode {

  public getTagName (): string {
    return `ng-container`
  }

}

export type RootLevelTemplateNode =
  TextTemplateNode |
  InterpolationTemplateNode |
  ElementTemplateNode |
  NgTemplateTemplateNode |
  NgContainerTemplateNode |
  CommentTemplateNode

// endregion Elements, ng-template and ng-container

// region Attributes (text attributes, inputs, outputs)

export abstract class AttributeTemplateNode extends TemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template) {
    super(project, locationSpan, tokens, template)
  }

  protected getNameToken () {
    return this.getFirstTokenOfTypeOrThrow(TokenType.ATTR_NAME)
  }

  protected getValueToken () {
    return this.getFirstTokenOfType(TokenType.ATTR_VALUE)
  }

  public changeName (newName: string): this {
    this._replaceTextByTokens([
      { token: this.getNameToken(), newText: newName }
    ])
    return this
  }

}

export class TextAttributeTemplateNode extends AttributeTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected name: string,
                      protected value: string) {
    super(project, locationSpan, tokens, template)
  }

  public getName (): string {
    return this.name
  }

  public getValue (): string {
    return this.value
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class BoundAttributeTemplateNode extends AttributeTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected name: string,
                      protected value: string) {
    super(project, locationSpan, tokens, template)
  }

  public getName (): string {
    return this.name
  }

  public getValue (): string {
    return this.value
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class BoundEventTemplateNode extends AttributeTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected name: string,
                      protected handler: string) {
    super(project, locationSpan, tokens, template)
  }

  public getName (): string {
    return this.name
  }

  public getHandler (): string {
    return this.handler
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class BananaInTheBoxTemplateNode extends AttributeTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected name: string,
                      protected value: string) {
    super(project, locationSpan, tokens, template)
  }

  public getName (): string {
    return this.name
  }

  public getValue (): string {
    return this.value
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class ReferenceTemplateNode extends AttributeTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected text: string,
                      protected value: string) {
    super(project, locationSpan, tokens, template)
  }

  public getName (): string {
    // Remove leading '#'
    return this.text.slice(1)
  }

  public getValue (): string {
    return this.value
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

// endregion Attributes (text attributes, inputs, outputs)

export class CommentTemplateNode extends TemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected value: string | null) {
    super(project, locationSpan, tokens, template)
  }

  public getValue (): string | null {
    return this.value
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export abstract class BindingTargetTemplateNode extends TemplateNode {
}

export class PropertyBindingTargetTemplateNode extends BindingTargetTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected text: string,
                      protected name: string) {
    super(project, locationSpan, tokens, template)
  }

  public getText (): string {
    return this.text
  }

  public getName (): string {
    return this.name
  }

  // public isBare (): boolean {
  //
  // }
  //
  // public isWithBrackets (): boolean {
  //
  // }
  //
  // public isWithBindPrefix (): boolean {
  //
  // }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class EventBindingTargetTemplateNode extends BindingTargetTemplateNode {

  public constructor (project: Project,
                      locationSpan: LocationSpan,
                      tokens: Token[],
                      template: Template,
                      protected text: string,
                      protected name: string) {
    super(project, locationSpan, tokens, template)
  }

  public getText (): string {
    return this.text
  }

  public getName (): string {
    return this.name
  }

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class ExpressionTemplateNode extends TemplateNode {

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}

export class StatementTemplateNode extends TemplateNode {

  public getTemplateChildren (): TemplateNode[] {
    return []
  }

}
