import { Injectable, Logger } from '@nestjs/common'
import { remove } from 'lodash'

import { KeyResultDTO } from 'domain/key-result/dto'
import { ProgressReportDTO } from 'domain/progress-report/dto'
import { UserDTO } from 'domain/user/dto'
import UserService from 'domain/user/service'

import { ProgressReport } from './entities'
import ProgressReportRepository from './repository'

@Injectable()
class ProgressReportService {
  private readonly logger = new Logger(ProgressReportService.name)

  constructor(
    private readonly repository: ProgressReportRepository,
    private readonly userService: UserService,
  ) {}

  async getOneById(id: ProgressReportDTO['id']): Promise<ProgressReport> {
    return this.repository.findOne({ id })
  }

  async getFromKeyResult(keyResultId: KeyResultDTO['id']): Promise<ProgressReport[]> {
    return this.repository.find({ keyResultId })
  }

  async getFromUser(userId: UserDTO['id']): Promise<ProgressReport[]> {
    return this.repository.find({ userId })
  }

  async getOneByIdIfUserIsInCompany(
    id: ProgressReportDTO['id'],
    user: UserDTO,
  ): Promise<ProgressReport | null> {
    const userCompanies = await this.userService.parseRequestUserCompanies(user)

    this.logger.debug({
      userCompanies,
      user,
      message: `Reduced companies for user`,
    })

    const data = await this.repository.findByIDWithCompanyConstraint(id, userCompanies)

    return data
  }

  async getLatestFromKeyResult(
    keyResultId: KeyResultDTO['id'],
  ): Promise<ProgressReport | undefined> {
    return this.repository.findOne({ where: { keyResultId }, order: { createdAt: 'DESC' } })
  }

  async create(
    progressReports: Partial<ProgressReportDTO> | Array<Partial<ProgressReportDTO>>,
  ): Promise<ProgressReport[]> {
    const enhancementPromises = Array.isArray(progressReports)
      ? progressReports.map(this.enhanceWithPreviousValue)
      : [this.enhanceWithPreviousValue(progressReports)]
    const progressReportsWithPreviousValues = remove(await Promise.all(enhancementPromises))

    this.logger.debug({
      progressReportsWithPreviousValues,
      message: 'Creating new progress report',
    })

    const data = await this.repository.insert(progressReportsWithPreviousValues)
    const createdProgressReports = data.raw

    return createdProgressReports
  }

  async enhanceWithPreviousValue(
    progressReport: Partial<ProgressReportDTO>,
  ): Promise<Partial<ProgressReportDTO | undefined>> {
    const latestProgressReport = await this.getLatestFromKeyResult(progressReport.keyResultId)
    const enhancedProgressReport = {
      ...progressReport,
      valuePrevious: latestProgressReport?.valueNew,
    }

    this.logger.debug({
      progressReport,
      enhancedProgressReport,
      latestProgressReport,
      message: 'Enhancing progress report with latest report value',
    })

    if (enhancedProgressReport.valuePrevious === enhancedProgressReport.valueNew) return
    return enhancedProgressReport
  }
}

export default ProgressReportService
