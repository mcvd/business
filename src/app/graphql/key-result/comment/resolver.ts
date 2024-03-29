import { Logger, UseGuards, UseInterceptors } from '@nestjs/common'
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql'
import { UserInputError, ApolloError } from 'apollo-server-fastify'
import { uniq } from 'lodash'

import { PERMISSION, POLICY, RESOURCE } from 'src/app/authz/constants'
import { Permissions } from 'src/app/authz/decorators'
import AuthzService from 'src/app/authz/service'
import { ActionPolicies, AuthzUser } from 'src/app/authz/types'
import { GraphQLUser } from 'src/app/graphql/authz/decorators'
import { GraphQLAuthzAuthGuard, GraphQLAuthzPermissionGuard } from 'src/app/graphql/authz/guards'
import { EnhanceWithBudUser } from 'src/app/graphql/authz/interceptors'
import { KeyResultObject } from 'src/app/graphql/key-result/models'
import GraphQLEntityResolver from 'src/app/graphql/resolver'
import { UserObject } from 'src/app/graphql/user'
import { KeyResultCommentDTO } from 'src/domain/key-result/comment/dto'
import { KeyResultComment } from 'src/domain/key-result/comment/entities'
import DomainService from 'src/domain/service'
import RailwayProvider from 'src/railway'

import {
  KeyResultCommentDeleteResultObject,
  KeyResultCommentInput,
  KeyResultCommentObject,
} from './models'

@UseGuards(GraphQLAuthzAuthGuard, GraphQLAuthzPermissionGuard)
@UseInterceptors(EnhanceWithBudUser)
@Resolver(() => KeyResultCommentObject)
class GraphQLCommentResolver extends GraphQLEntityResolver<KeyResultComment, KeyResultCommentDTO> {
  private readonly logger = new Logger(GraphQLCommentResolver.name)

  constructor(
    protected readonly domain: DomainService,
    protected readonly authzService: AuthzService,
    private readonly railway: RailwayProvider,
  ) {
    super(RESOURCE.KEY_RESULT_COMMENT, domain, domain.keyResult.comment, authzService)
  }

  @Permissions(PERMISSION['KEY_RESULT_COMMENT:READ'])
  @Query(() => KeyResultCommentObject, { name: 'keyResultComment' })
  protected async getComment(
    @Args('id', { type: () => ID }) id: KeyResultCommentObject['id'],
    @GraphQLUser() user: AuthzUser,
  ) {
    this.logger.log(`Fetching key result comment with id ${id}`)

    const comment = await this.getOneWithActionScopeConstraint({ id }, user)
    if (!comment) throw new UserInputError(`We could not found a comment with id ${id}`)

    return comment
  }

  @Permissions(PERMISSION['KEY_RESULT_COMMENT:CREATE'])
  @Mutation(() => KeyResultCommentObject, { name: 'createKeyResultComment' })
  protected async createKeyResultComment(
    @GraphQLUser() user: AuthzUser,
    @Args('keyResultComment', { type: () => KeyResultCommentInput })
    keyResultComment: KeyResultCommentInput,
  ) {
    this.logger.log({
      user,
      keyResultComment,
      message: 'Received create comment request',
    })

    const keyResult = await this.domain.keyResult.getOne({ id: keyResultComment.keyResultId })
    const objective = await this.domain.objective.getFromKeyResult(keyResult)
    const cycle = await this.domain.cycle.getFromObjective(objective)
    if (!cycle.active)
      throw new UserInputError(
        'You cannot create this comment, because that cycle is not active anymore',
      )

    const comment = await this.domain.keyResult.buildCommentForUser(user, keyResultComment)
    const createCommentPromise = this.createWithActionScopeConstraint(comment, user)

    this.logger.log({
      user,
      keyResultComment,
      message: 'Creating a new comment in our database',
    })

    const [error, createdComments] = await this.railway.execute<KeyResultComment[]>(
      createCommentPromise,
    )
    if (error) throw new ApolloError(error.message)
    if (!createdComments || createdComments.length === 0)
      throw new UserInputError(
        `We could not find any key result with ID ${keyResultComment.keyResultId} to add your comment`,
      )

    const createdComment = createdComments[0]

    return createdComment
  }

  @Permissions(PERMISSION['KEY_RESULT_COMMENT:DELETE'])
  @Mutation(() => KeyResultCommentDeleteResultObject, { name: 'deleteKeyResultComment' })
  protected async deleteKeyResultComment(
    @GraphQLUser() user: AuthzUser,
    @Args('id', { type: () => ID }) keyResultCommentID: KeyResultComment['id'],
  ) {
    this.logger.log({
      user,
      keyResultCommentID,
      message: 'Removing key result comment',
    })

    const keyResult = await this.domain.keyResult.getFromKeyResultCommentID(keyResultCommentID)
    const objective = await this.domain.objective.getFromKeyResult(keyResult)
    const cycle = await this.domain.cycle.getFromObjective(objective)
    if (!cycle.active)
      throw new UserInputError(
        'You cannot delete this comment, because that cycle is not active anymore',
      )

    const selector = { id: keyResultCommentID }
    const result = await this.deleteWithActionScopeConstraint(selector, user)
    if (!result)
      throw new UserInputError(
        `We could not find any key result comment with ${keyResultCommentID} to delete`,
      )

    return result
  }

  @ResolveField('user', () => UserObject)
  protected async getKeyResultCommentUser(@Parent() comment: KeyResultCommentObject) {
    this.logger.log({
      comment,
      message: 'Fetching user for key result comment',
    })

    return this.domain.user.getOne({ id: comment.userId })
  }

  @ResolveField('keyResult', () => KeyResultObject)
  protected async getKeyResultCommentKeyResult(@Parent() comment: KeyResultCommentObject) {
    this.logger.log({
      comment,
      message: 'Fetching key result for key result comment',
    })

    return this.domain.keyResult.getOne({ id: comment.keyResultId })
  }

  protected async customizeEntityPolicies(
    originalPolicies: ActionPolicies,
    keyResultComment: KeyResultComment,
  ) {
    const restrictedToActivePolicies = await this.restrictPoliciesToActiveKeyResult(
      originalPolicies,
      keyResultComment,
    )

    return restrictedToActivePolicies
  }

  private async restrictPoliciesToActiveKeyResult(
    originalPolicies: ActionPolicies,
    keyResultComment: KeyResultComment,
  ) {
    const parsedPolicyValues = uniq(Object.values(originalPolicies))
    if (parsedPolicyValues === [POLICY.DENY]) return originalPolicies

    const keyResult = await this.domain.keyResult.getOne({ id: keyResultComment.keyResultId })
    const objective = await this.domain.objective.getFromKeyResult(keyResult)
    const cycle = await this.domain.cycle.getFromObjective(objective)

    return cycle.active ? originalPolicies : this.denyAllPolicies(originalPolicies)
  }
}

export default GraphQLCommentResolver
