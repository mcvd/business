import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GqlExecutionContext } from '@nestjs/graphql'
import { fromPairs } from 'lodash'

import { ACTION, RESOURCE } from 'src/app/authz/constants'
import AuthzService from 'src/app/authz/service'
import { AppRequest } from 'src/app/types'
import { CONSTRAINT } from 'src/domain/constants'
import DomainService from 'src/domain/service'
import { User } from 'src/domain/user/entities'

@Injectable()
export class EnhanceWithBudUser implements NestInterceptor {
  private readonly logger = new Logger(EnhanceWithBudUser.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly authzService: AuthzService,
    private readonly domain: DomainService,
  ) {}

  public async intercept(rawContext: ExecutionContext, next: CallHandler) {
    const gqlContext = GqlExecutionContext.create(rawContext)
    const request: AppRequest = gqlContext.getContext().req
    const isGodModeEnabled = this.configService.get('godMode.enabled')

    if (isGodModeEnabled) return this.authzService.godBypass(request, next)

    const { teams, ...user }: User = await this.domain.user.getUserFromSubjectWithTeamRelation(
      request.user.token.sub,
    )
    const scopes = this.authzService.parseActionScopesFromUserPermissions(
      request.user.token.permissions,
    )

    request.user = {
      ...request.user,
      ...user,
      teams,
      scopes,
    }

    this.logger.debug({
      requestUser: request.user,
      message: `Selected user with ID ${user.id} for current request`,
    })

    return next.handle()
  }
}

@Injectable()
export class EnhanceWithUserResourceConstraint implements NestInterceptor {
  private readonly logger = new Logger(EnhanceWithUserResourceConstraint.name)

  constructor(private readonly authzService: AuthzService) {}

  public async intercept(rawContext: ExecutionContext, next: CallHandler) {
    const gqlContext = GqlExecutionContext.create(rawContext)
    const request: AppRequest = gqlContext.getContext().req
    const { user } = request

    const handlerPermissions = this.authzService.parseHandlerPermissions(gqlContext.getHandler())
    const handlerResourceActions = handlerPermissions.map((handlerPermission) =>
      handlerPermission.split(':'),
    ) as Array<[RESOURCE, ACTION]>
    const handlerResourceConstraintPairs: Array<
      [RESOURCE, CONSTRAINT]
    > = handlerResourceActions.map(([resource, action]) => [
      resource,
      user.scopes[resource][action],
    ])

    const handlerConstraint = fromPairs<CONSTRAINT>(handlerResourceConstraintPairs)
    request.user = {
      ...user,
      constraint: handlerConstraint,
    }

    this.logger.debug({
      user,
      handlerConstraint,
      message: 'Enhanced request with user constraint for resource',
    })

    return next.handle()
  }
}
