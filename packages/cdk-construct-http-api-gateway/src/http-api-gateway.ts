import { contextId, contextTags, isEnabled } from '@sevenpico/cdk-context';
import {
  RemovalPolicy,
  Tags,
  Fn,
  aws_apigatewayv2 as apigwv2,
  aws_logs as logs,
  aws_route53 as route53,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { corsConfigProperty, defaultAccessLogFormat } from './http-api-gateway-fns';
import { HttpApiGatewayProps } from './http-api-gateway-types';

export class HttpApiGateway extends Construct {
  public readonly api?: apigwv2.CfnApi;
  public readonly logGroup?: logs.LogGroup;
  public readonly customDomain?: apigwv2.CfnDomainName;

  constructor(scope: Construct, id: string, props: HttpApiGatewayProps) {
    super(scope, id);
    if (!isEnabled(props.context)) return;

    // Access log group
    let logGroup: logs.LogGroup | undefined;
    if (props.accessLoggingEnabled !== false) {
      logGroup = new logs.LogGroup(this, 'AccessLogs', {
        logGroupName: `/aws/apigateway/${contextId(props.context)}`,
        retention: (props.cloudwatchLogsRetentionDays ?? 7) as logs.RetentionDays,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      this.logGroup = logGroup;
    }

    // HTTP API — when openApiBody is provided, AWS rejects top-level fields that must be defined
    // inside the spec (name, protocolType, corsConfiguration, etc.)
    this.api = new apigwv2.CfnApi(this, 'Api', props.openApiBody
      ? { body: props.openApiBody }
      : {
        name: contextId(props.context),
        protocolType: 'HTTP',
        description: props.description,
        disableExecuteApiEndpoint: props.disableExecuteApiEndpoint ?? true,
        version: props.apiVersion,
        corsConfiguration: corsConfigProperty(props.corsConfiguration),
      },
    );

    // Default stage
    const stage = new apigwv2.CfnStage(this, 'DefaultStage', {
      apiId: this.api.ref,
      stageName: '$default',
      autoDeploy: props.enableAutoDeploy ?? false,
      stageVariables: props.stageVariables,
      accessLogSettings: logGroup ? {
        destinationArn: logGroup.logGroupArn,
        format: props.accessLogFormat ?? defaultAccessLogFormat(),
      } : undefined,
    });

    // Additional named stages
    (props.stages ?? []).forEach((stageCfg) => {
      new apigwv2.CfnStage(this, `Stage-${stageCfg.stageName}`, {
        apiId: this.api!.ref,
        stageName: stageCfg.stageName,
        autoDeploy: stageCfg.autoDeploy ?? false,
        stageVariables: props.stageVariables,
        accessLogSettings: logGroup ? {
          destinationArn: logGroup.logGroupArn,
          format: props.accessLogFormat ?? defaultAccessLogFormat(),
        } : undefined,
      });
    });

    // VPC links (created regardless of openApiBody — VPC link IDs are referenced inside the spec)
    const vpcLinkMap: Record<string, apigwv2.CfnVpcLink> = {};
    Object.entries(props.vpcLinks ?? {}).forEach(([key, vlCfg]) => {
      vpcLinkMap[key] = new apigwv2.CfnVpcLink(this, `VpcLink-${key}`, {
        name: `${contextId(props.context)}-${key}`,
        subnetIds: vlCfg.subnetIds,
        securityGroupIds: vlCfg.securityGroupIds,
      });
    });

    // Integrations, authorizers, and routes — skipped when openApiBody is provided
    // (the spec defines all three; attach authorizers there via
    // x-amazon-apigateway-authorizer instead)
    if (!props.openApiBody) {
      const integrationMap: Record<string, apigwv2.CfnIntegration> = {};
      Object.entries(props.integrations ?? {}).forEach(([key, intCfg]) => {
        const integrationProps: apigwv2.CfnIntegrationProps = {
          apiId: this.api!.ref,
          integrationType: intCfg.type,
          integrationUri: intCfg.uri,
          credentialsArn: intCfg.credentialsArn,
          integrationMethod: intCfg.method,
          payloadFormatVersion: intCfg.payloadFormatVersion ?? '2.0',
        };
        integrationMap[key] = new apigwv2.CfnIntegration(this, `Integration-${key}`, integrationProps);
      });

      // Authorizers — referenced by route.authorizerKey below. `type` drives both
      // the AWS::ApiGatewayV2::Authorizer shape and the route's AuthorizationType
      // ('LAMBDA' authorizers are CFN AuthorizerType REQUEST / route type CUSTOM).
      const authorizerMap: Record<string, { ref?: string; authorizationType: string }> = {};
      Object.entries(props.authorizers ?? {}).forEach(([key, authCfg]) => {
        if (authCfg.type === 'JWT') {
          const authorizer = new apigwv2.CfnAuthorizer(this, `Authorizer-${key}`, {
            apiId: this.api!.ref,
            name: `${contextId(props.context)}-${key}`,
            authorizerType: 'JWT',
            identitySource: authCfg.identitySources ?? ['$request.header.Authorization'],
            jwtConfiguration: {
              audience: authCfg.jwtAudience,
              issuer: authCfg.jwtIssuer,
            },
          });
          authorizerMap[key] = { ref: authorizer.ref, authorizationType: 'JWT' };
        } else if (authCfg.type === 'LAMBDA') {
          const authorizer = new apigwv2.CfnAuthorizer(this, `Authorizer-${key}`, {
            apiId: this.api!.ref,
            name: `${contextId(props.context)}-${key}`,
            authorizerType: 'REQUEST',
            authorizerUri: authCfg.lambdaArn,
            authorizerPayloadFormatVersion: '2.0',
            identitySource: authCfg.identitySources ?? ['$request.header.Authorization'],
          });
          authorizerMap[key] = { ref: authorizer.ref, authorizationType: 'CUSTOM' };
        } else if (authCfg.type === 'NONE') {
          authorizerMap[key] = { authorizationType: 'NONE' };
        }
      });

      Object.entries(props.routes ?? {}).forEach(([key, routeCfg]) => {
        const integration = integrationMap[routeCfg.integrationKey];
        if (!integration) return;
        let authorizer: { ref?: string; authorizationType: string } | undefined;
        if (routeCfg.authorizerKey) {
          authorizer = authorizerMap[routeCfg.authorizerKey];
          if (!authorizer) {
            throw new Error(
              `HttpApiGateway: route "${key}" references authorizerKey "${routeCfg.authorizerKey}", ` +
              'which has no corresponding entry in `authorizers` (or its type is unrecognized).',
            );
          }
        }
        new apigwv2.CfnRoute(this, `Route-${key}`, {
          apiId: this.api!.ref,
          routeKey: routeCfg.routeKey,
          target: Fn.join('', ['integrations/', integration.ref]),
          operationName: routeCfg.operationName,
          authorizationType: authorizer?.authorizationType,
          authorizerId: authorizer?.ref,
        });
      });
    }

    // Custom domain
    if (props.dnsName && props.acmCertificateArn) {
      this.customDomain = new apigwv2.CfnDomainName(this, 'Domain', {
        domainName: props.dnsName,
        domainNameConfigurations: [{
          certificateArn: props.acmCertificateArn,
          endpointType: 'REGIONAL',
        }],
      });

      new apigwv2.CfnApiMapping(this, 'Mapping', {
        apiId: this.api.ref,
        domainName: this.customDomain.ref,
        stage: stage.ref,
      });

      // Route53 alias records — use L1 CfnRecordSet to avoid zone name lookup
      (props.route53ZoneIds ?? []).forEach((zoneId, i) => {
        new route53.CfnRecordSet(this, `DnsAlias${i}`, {
          hostedZoneId: zoneId,
          name: `${props.dnsName}.`,
          type: 'A',
          aliasTarget: {
            dnsName: this.customDomain!.attrRegionalDomainName,
            hostedZoneId: this.customDomain!.attrRegionalHostedZoneId,
            evaluateTargetHealth: false,
          },
        });
      });
    }

    Object.entries(contextTags(props.context)).forEach(([k, v]) => {
      Tags.of(this).add(k, v);
      // AWS rejects tags on CfnApi when Body is provided — tags must live inside the spec
      if (props.openApiBody && this.api) Tags.of(this.api).remove(k);
    });
  }
}
