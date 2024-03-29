import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { sum } from 'lodash'
import { Any, SelectQueryBuilder } from 'typeorm'

import { DOMAIN_SORTING } from 'src/domain/constants'
import { DomainCreationQuery, DomainEntityService, DomainQueryContext } from 'src/domain/entity'
import {
  MAX_PERCENTAGE_PROGRESS,
  MIN_PERCENTAGE_PROGRESS,
} from 'src/domain/key-result/check-in/constants'
import { KeyResultCheckInDTO } from 'src/domain/key-result/check-in/dto'
import { KeyResultCheckIn } from 'src/domain/key-result/check-in/entities'
import { KeyResultDTO } from 'src/domain/key-result/dto'
import { KeyResult } from 'src/domain/key-result/entities'
import DomainKeyResultService from 'src/domain/key-result/service'
import { DomainKeyResultTimelineOrderEntry } from 'src/domain/key-result/timeline'
import { DEFAULT_CONFIDENCE } from 'src/domain/team/constants'
import { UserDTO } from 'src/domain/user/dto'

import DomainKeyResultCheckInRepository from './repository'

export interface DomainKeyResultCheckInServiceInterface {
  getLatestFromUsers: (users: UserDTO[]) => Promise<KeyResultCheckIn | null>
  getLatestFromKeyResult: (keyResult: KeyResultDTO) => Promise<KeyResultCheckIn | null>
  getLatestFromKeyResultAtDate: (
    keyResult: KeyResultDTO,
    date: Date,
  ) => Promise<KeyResultCheckIn | null>
  transformCheckInToRelativePercentage: (
    keyResult: KeyResult,
    checkIn?: KeyResultCheckIn,
  ) => KeyResultCheckIn
  limitPercentageCheckIn: (checkIn: KeyResultCheckIn) => KeyResultCheckIn
  calculateAverageValueFromCheckInList: (
    checkIns: KeyResultCheckIn[],
  ) => KeyResultCheckInDTO['value']
  calculateValueDifference: (
    oldCheckIn: KeyResultCheckInDTO,
    newCheckIn: KeyResultCheckInDTO,
  ) => number
  calculateConfidenceDifference: (
    oldCheckIn: KeyResultCheckInDTO,
    newCheckIn: KeyResultCheckInDTO,
  ) => number
  getForTimelineEntries: (
    entries: DomainKeyResultTimelineOrderEntry[],
  ) => Promise<KeyResultCheckIn[]>
}

@Injectable()
class DomainKeyResultCheckInService extends DomainEntityService<
  KeyResultCheckIn,
  KeyResultCheckInDTO
> {
  constructor(
    protected readonly repository: DomainKeyResultCheckInRepository,
    @Inject(forwardRef(() => DomainKeyResultService))
    private readonly keyResultService: DomainKeyResultService,
  ) {
    super(DomainKeyResultCheckInService.name, repository)
  }

  public async getLatestFromUsers(users: UserDTO[]) {
    const userIDs = users.map((user) => user.id)
    if (!userIDs || userIDs.length === 0) return

    const selector = {
      userId: Any(userIDs),
    }

    const latestCheckInArray = await this.repository.find({
      where: selector,
      take: 1,
      order: {
        createdAt: DOMAIN_SORTING.DESC,
      },
    })

    const latestCheckIn = latestCheckInArray[0]

    return latestCheckIn
  }

  public async getLatestFromKeyResult(keyResult: KeyResultDTO) {
    const date = new Date()
    const checkIn = await this.repository.getLatestFromDateForKeyResult(date, keyResult)

    return checkIn
  }

  public async getLatestFromKeyResultAtDate(keyResult: KeyResultDTO, snapshot: Date) {
    const checkIn = await this.repository.getLatestFromDateForKeyResult(snapshot, keyResult)

    return checkIn
  }

  public transformCheckInToRelativePercentage(keyResult: KeyResult, checkIn?: KeyResultCheckIn) {
    const { initialValue, goal } = keyResult
    const value = checkIn ? checkIn.value : initialValue

    const relativePercentageProgress = ((value - initialValue) * 100) / (goal - initialValue)
    const normalizedCheckIn: KeyResultCheckIn = {
      ...checkIn,
      value: relativePercentageProgress,
    }

    const limitedNormalizedCheckIn = this.limitPercentageCheckIn(normalizedCheckIn)

    return limitedNormalizedCheckIn
  }

  public limitPercentageCheckIn(checkIn: KeyResultCheckIn) {
    const limitedValue = this.minmax(
      checkIn.value,
      MIN_PERCENTAGE_PROGRESS,
      MAX_PERCENTAGE_PROGRESS,
    )

    const limitedCheckIn: KeyResultCheckIn = {
      ...checkIn,
      value: limitedValue,
    }

    return limitedCheckIn
  }

  public calculateAverageValueFromCheckInList(checkIns: KeyResultCheckIn[]) {
    const valueList = checkIns.map((checkIn) => checkIn?.value ?? 0)
    const numberOfCheckIns = valueList.length === 0 ? 1 : valueList.length

    const averageValue = sum(valueList) / numberOfCheckIns

    return averageValue
  }

  public calculateValueDifference(
    oldCheckIn: KeyResultCheckInDTO,
    newCheckIn: KeyResultCheckInDTO,
  ) {
    const deltaValue = newCheckIn.value - oldCheckIn.value

    return deltaValue
  }

  public calculateConfidenceDifference(
    oldCheckIn: KeyResultCheckInDTO,
    newCheckIn: KeyResultCheckInDTO,
  ) {
    const { confidence } = newCheckIn
    const previousConfidence = oldCheckIn?.confidence ?? DEFAULT_CONFIDENCE

    const deltaConfidence = confidence - previousConfidence

    return deltaConfidence
  }

  public async getForTimelineEntries(entries: DomainKeyResultTimelineOrderEntry[]) {
    const checkInIDs = entries.map((entry) => entry.id)
    const result = await this.repository.findByIds(checkInIDs)

    return result
  }

  protected async protectCreationQuery(
    query: DomainCreationQuery<KeyResultCheckIn>,
    data: Partial<KeyResultCheckInDTO>,
    queryContext: DomainQueryContext,
  ) {
    const selector = { id: data.keyResultId }

    const validationData = await this.keyResultService.getOneWithConstraint(selector, queryContext)
    if (!validationData) return

    return query()
  }

  protected async setupDeleteMutationQuery(query: SelectQueryBuilder<KeyResultCheckIn>) {
    const currentKeyResultCheckIn = await query
      .leftJoinAndSelect(`${KeyResultCheckIn.name}.keyResult`, 'keyResult')
      .getOne()
    if (!currentKeyResultCheckIn) return query

    const { keyResult } = currentKeyResultCheckIn
    const latestCheckIn = await this.getLatestFromKeyResult(keyResult)

    const constrainedQuery = query.andWhere(`${KeyResultCheckIn.name}.id = :latestCheckInID`, {
      latestCheckInID: latestCheckIn.id,
    })

    return constrainedQuery
  }

  private minmax(value: number, min: number, max: number) {
    const isBetween = value >= min && value <= max
    const isLess = value < min

    const minOrMax = isLess ? min : max

    return isBetween ? value : minOrMax
  }
}

export default DomainKeyResultCheckInService
