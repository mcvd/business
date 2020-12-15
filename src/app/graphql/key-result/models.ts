import { Field, Float, ID, InputType, ObjectType, registerEnumType } from '@nestjs/graphql'

import { ObjectiveObject } from 'app/graphql/objective/models'
import { TeamObject } from 'app/graphql/team/models'
import { PoliciesObject, UserObject } from 'app/graphql/user/models'
import { KeyResultFormat } from 'domain/key-result/types'

import { ConfidenceReportObject } from './report/confidence/models'
import { ProgressReportObject } from './report/progress/models'

registerEnumType(KeyResultFormat, {
  name: 'KeyResultFormat',
  description: 'Each format represents how our user wants to see the metrics of the key result',
})

@ObjectType('KeyResult', {
  description: 'A goal that is created for the team focusing in a given team objective',
})
export class KeyResultObject {
  @Field(() => ID, { description: 'The ID of the key result' })
  id: number

  @Field({ description: 'The title(name) of the key result' })
  title: string

  @Field({ nullable: true, description: 'The description explaining the key result' })
  description?: string

  @Field(() => Float, { description: 'The initial value of the key result' })
  initialValue: number

  @Field(() => Float, { description: 'The goal of the key result' })
  goal: number

  @Field({ description: 'The format of the key result' })
  format: KeyResultFormat

  @Field({ description: 'The creation date of the key result' })
  createdAt: Date

  @Field({ description: 'The last update date of the key result' })
  updatedAt: Date

  @Field(() => ID, { description: 'The owner ID of the key result' })
  ownerId: UserObject['id']

  @Field(() => UserObject, { description: 'The owner of the key result' })
  owner: UserObject

  @Field(() => ID, { description: 'The object ID that this key result belongs to' })
  objectiveId: ObjectiveObject['id']

  @Field(() => ObjectiveObject, { description: 'The objective that this key result belongs to' })
  objective: ObjectiveObject

  @Field(() => ID, { description: 'The team ID that this key result belongs to' })
  teamId: TeamObject['id']

  @Field(() => TeamObject, { description: 'The team that this key result belongs to' })
  team: TeamObject

  @Field(() => [ProgressReportObject], {
    description: 'The creation date ordered list of progress reports for this key result',
  })
  progressReports: ProgressReportObject[]

  @Field(() => [ConfidenceReportObject], {
    description: 'The creation date ordered list of confidence reports for this key result',
  })
  confidenceReports: ConfidenceReportObject[]

  @Field(() => PoliciesObject, {
    description:
      'Group of policies regarding given key result. Those policies decribe actions that your user can perform with that given resource',
  })
  policies: PoliciesObject
}

@InputType('KeyResultInput', {
  description: 'Partial key result data you can send to update a given key result',
})
export class KeyResultInput {
  @Field({ nullable: true, description: 'The title(name) of the key result' })
  title?: string

  @Field({ nullable: true, description: 'The description explaining the key result' })
  description?: string

  @Field(() => Float, { nullable: true, description: 'The initial value of the key result' })
  initialValue?: number

  @Field(() => Float, { nullable: true, description: 'The goal of the key result' })
  goal?: number

  @Field({ nullable: true, description: 'The format of the key result' })
  format?: KeyResultFormat

  @Field(() => ID, { nullable: true, description: 'The owner ID of the key result' })
  ownerId?: UserObject['id']

  @Field(() => ID, { nullable: true, description: 'The object ID that this key result belongs to' })
  objectiveId?: ObjectiveObject['id']

  @Field(() => ID, { nullable: true, description: 'The team ID that this key result belongs to' })
  teamId?: TeamObject['id']
}