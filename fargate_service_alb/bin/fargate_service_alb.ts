#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { FargateServiceAlbStack } from '../lib/fargate_service_alb-stack';

const app = new cdk.App();
new FargateServiceAlbStack(app, 'FargateServiceAlbStack');
