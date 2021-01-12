import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { uniq } from 'lodash'

import DomainEntityService from 'domain/service'
import { TeamDTO } from 'domain/team/dto'
import DomainTeamService from 'domain/team/service'
import { UserDTO } from 'domain/user/dto'

import { User } from './entities'
import DomainUserRepository from './repository'
import DomainUserViewService from './view/service'

@Injectable()
class DomainUserService extends DomainEntityService<User, UserDTO> {
  constructor(
    @Inject(forwardRef(() => DomainUserViewService))
    public readonly view: DomainUserViewService,
    public readonly repository: DomainUserRepository,
    private readonly teamService: DomainTeamService,
  ) {
    super(repository, DomainUserService.name)
  }

  async parseUserCompanyIDs(user: UserDTO) {
    const userCompanies = await this.teamService.getUserRootTeams(user)
    const userCompanyIDs = uniq(userCompanies.map((company) => company.id))

    return userCompanyIDs
  }

  async parseUserCompaniesTeamIDs(companyIDs: Array<TeamDTO['id']>) {
    const companiesTeams = await this.teamService.getAllTeamsBelowNodes(companyIDs)
    const companiesTeamIDs = uniq(companiesTeams.map((team) => team.id))

    return companiesTeamIDs
  }

  async getUserFromSubjectWithTeamRelation(authzSub: UserDTO['authzSub']): Promise<User> {
    return this.repository.findOne({ authzSub }, { relations: ['teams'] })
  }

  buildUserFullName(user: UserDTO) {
    return `${user.firstName} ${user.lastName}`
  }
}

export default DomainUserService
