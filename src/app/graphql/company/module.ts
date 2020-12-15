import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import appConfig from 'config/app'
import DomainModule from 'domain/module'

import GraphQLCompanyResolver from './resolver'
import GraphQLCompanyService from './service'

@Module({
  imports: [ConfigModule.forFeature(appConfig), DomainModule],
  providers: [GraphQLCompanyResolver, GraphQLCompanyService],
})
class GraphQLCompanysModule {}

export default GraphQLCompanysModule