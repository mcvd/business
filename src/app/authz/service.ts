import { Injectable, CallHandler } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { mapValues, uniq, fromPairs, Dictionary } from 'lodash'
import { Observable } from 'rxjs'
import { Any } from 'typeorm'

import { AppRequest } from 'src/app/types'
import { CONSTRAINT, CONSTRAINT_ORDER } from 'src/domain/constants'
import DomainService from 'src/domain/service'

import { ACTION, PERMISSION, POLICY, RESOURCE, SCOPED_PERMISSION } from './constants'
import AuthzGodUser from './god-user'
import { AuthzScopeGroup, AuthzScopes, AuthzUser, ActionPolicies, AuthzToken } from './types'

export interface AuthzServiceInterface {
  godBypass: (request: AppRequest, next: CallHandler) => Promise<Observable<any>>
  parseActionScopesFromUserPermissions: (permissions: SCOPED_PERMISSION[]) => AuthzScopes
  getUserPoliciesForConstraint: (
    user: AuthzUser,
    constraint: CONSTRAINT,
    resources?: RESOURCE[],
  ) => Dictionary<ActionPolicies>
  userHasPermission: (userPermissions: PERMISSION[], requiredPermissions: PERMISSION[]) => boolean
  drillUpScopedPermissions: (scopedPermissions: SCOPED_PERMISSION[]) => PERMISSION[]
  // eslint-disable-next-line @typescript-eslint/ban-types
  parseHandlerPermissions: (handler: Function) => PERMISSION[]
  parseTokenPermissions: (token: AuthzToken) => PERMISSION[]
}

@Injectable()
class AuthzService implements AuthzServiceInterface {
  constructor(
    private readonly configService: ConfigService,
    private readonly godUser: AuthzGodUser,
    private readonly domain: DomainService,
    private readonly reflector: Reflector,
  ) {}

  public async godBypass(request: AppRequest, next: CallHandler) {
    const godContext = {
      user: {},
      constraint: CONSTRAINT.ANY,
    }

    const teamsPromise = this.domain.team.getManyWithConstraint(
      { id: Any(this.configService.get('godMode.teamIDs')) },
      godContext as any,
    )

    const user = {
      teams: await teamsPromise,
      id: this.godUser.id,
      firstName: this.godUser.firstName,
      authzSub: this.godUser.authzSub,
      role: this.godUser.role,
      token: this.godUser.token,
      scopes: this.godUser.scopes,
      picture: this.godUser.picture,
      createdAt: this.godUser.createdAt,
      updatedAt: this.godUser.updatedAt,
    }

    request.user = user

    return next.handle()
  }

  public parseActionScopesFromUserPermissions(permissions: SCOPED_PERMISSION[]) {
    const permissionActionScopes = this.parseActionScopesForResource(
      RESOURCE.PERMISSION,
      permissions,
    )
    const userActionScopes = this.parseActionScopesForResource(RESOURCE.USER, permissions)
    const teamActionScopes = this.parseActionScopesForResource(RESOURCE.TEAM, permissions)
    const cycleActionScopes = this.parseActionScopesForResource(RESOURCE.CYCLE, permissions)
    const objectiveActionScopes = this.parseActionScopesForResource(RESOURCE.OBJECTIVE, permissions)
    const keyResultActionScopes = this.parseActionScopesForResource(
      RESOURCE.KEY_RESULT,
      permissions,
    )
    const keyResultCheckInActionScopes = this.parseActionScopesForResource(
      RESOURCE.KEY_RESULT_CHECK_IN,
      permissions,
    )
    const keyResultCommentActionScopes = this.parseActionScopesForResource(
      RESOURCE.KEY_RESULT_COMMENT,
      permissions,
    )
    const keyResultCustomListActionScopes = this.parseActionScopesForResource(
      RESOURCE.KEY_RESULT_CUSTOM_LIST,
      permissions,
    )

    return {
      [RESOURCE.PERMISSION]: permissionActionScopes,
      [RESOURCE.USER]: userActionScopes,
      [RESOURCE.TEAM]: teamActionScopes,
      [RESOURCE.CYCLE]: cycleActionScopes,
      [RESOURCE.OBJECTIVE]: objectiveActionScopes,
      [RESOURCE.KEY_RESULT]: keyResultActionScopes,
      [RESOURCE.KEY_RESULT_CHECK_IN]: keyResultCheckInActionScopes,
      [RESOURCE.KEY_RESULT_COMMENT]: keyResultCommentActionScopes,
      [RESOURCE.KEY_RESULT_CUSTOM_LIST]: keyResultCustomListActionScopes,
    }
  }

  public getUserPoliciesForConstraint(
    user: AuthzUser,
    constraint: CONSTRAINT,
    resources: RESOURCE[] = Object.values(RESOURCE),
  ) {
    const userResourcePermissionPairs = resources.map<[RESOURCE, ActionPolicies]>((resource) => [
      resource,
      this.buildActionPoliciesForUserInConstraint(user, constraint, resource),
    ])
    const userResourcePermissions = fromPairs<ActionPolicies>(userResourcePermissionPairs)

    return userResourcePermissions
  }

  public userHasPermission(userPermissions: PERMISSION[], requiredPermissions: PERMISSION[]) {
    if (!requiredPermissions || requiredPermissions.length === 0) return true

    const hasPermission = () =>
      requiredPermissions.every((requiredPermission) =>
        userPermissions.includes(requiredPermission),
      )

    return hasPermission()
  }

  public drillUpScopedPermissions(scopedPermissions: SCOPED_PERMISSION[]) {
    const permissions = scopedPermissions.map(
      (scopedPermission) => scopedPermission.split(':').slice(0, -1).join(':') as PERMISSION,
    )

    return permissions
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  public parseHandlerPermissions(handler: Function) {
    const permissions = this.reflector.get<PERMISSION[]>('permissions', handler)

    return permissions
  }

  public parseTokenPermissions(token: AuthzToken) {
    const scopedPermissions = token.permissions ?? []
    const permissions = this.drillUpScopedPermissions(scopedPermissions)

    return permissions
  }

  private parseActionScopesForResource(
    resource: RESOURCE,
    permissions: SCOPED_PERMISSION[],
  ): AuthzScopeGroup {
    const createScope = this.parseActionScopeForResource(ACTION.CREATE, resource, permissions)
    const readScope = this.parseActionScopeForResource(ACTION.READ, resource, permissions)
    const updateScope = this.parseActionScopeForResource(ACTION.UPDATE, resource, permissions)
    const deleteScope = this.parseActionScopeForResource(ACTION.DELETE, resource, permissions)

    return {
      [ACTION.CREATE]: createScope,
      [ACTION.READ]: readScope,
      [ACTION.UPDATE]: updateScope,
      [ACTION.DELETE]: deleteScope,
    }
  }

  private parseActionScopeForResource(
    action: ACTION,
    resource: RESOURCE,
    permissions: SCOPED_PERMISSION[],
  ): CONSTRAINT {
    const resourcePermissions = permissions.filter((permission) =>
      permission.includes(`${resource}:${action}`),
    )
    const highestScope = this.getHighestScopeForPermissions(resourcePermissions)

    return highestScope
  }

  private getHighestScopeForPermissions(permissions: SCOPED_PERMISSION[]): CONSTRAINT {
    const scopeWeights = {
      [CONSTRAINT.ANY]: 4,
      [CONSTRAINT.COMPANY]: 3,
      [CONSTRAINT.TEAM]: 2,
      [CONSTRAINT.OWNS]: 1,
    }
    const scopeList = permissions.map(
      (permission) => permission.split(':').slice(-1)[0] as CONSTRAINT,
    )
    const uniqueScopeList = uniq(scopeList)
    const weightedScopeList = uniqueScopeList.map((scope) => ({
      scope,
      weight: scopeWeights[scope],
    }))
    const sortedScopeList = weightedScopeList.sort((previous, next) =>
      previous.weight < next.weight ? 1 : -1,
    )

    const highestScope = sortedScopeList[0]

    return highestScope?.scope
  }

  private buildActionPoliciesForUserInConstraint(
    user: AuthzUser,
    constraint: CONSTRAINT,
    resource: RESOURCE,
  ) {
    const userScopes = user.scopes[resource]
    const userActionPolicies: ActionPolicies = mapValues(userScopes, (userConstraint) =>
      this.isConstraintHigherOrEqual(constraint, userConstraint) ? POLICY.ALLOW : POLICY.DENY,
    )

    return userActionPolicies
  }

  private isConstraintHigherOrEqual(base: CONSTRAINT, candidate?: CONSTRAINT) {
    if (!candidate) return false

    const baseIndex = CONSTRAINT_ORDER.indexOf(base)
    const candidateIndex = CONSTRAINT_ORDER.indexOf(candidate)

    return candidateIndex <= baseIndex
  }
}

export default AuthzService
