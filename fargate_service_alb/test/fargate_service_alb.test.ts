import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as FargateServiceAlb from '../lib/fargate_service_alb-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new FargateServiceAlb.FargateServiceAlbStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
