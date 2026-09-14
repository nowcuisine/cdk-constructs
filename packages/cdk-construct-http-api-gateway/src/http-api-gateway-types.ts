import { Context } from '@sevenpico/cdk-context';

export interface HttpApiRoute {
  readonly routeKey: string;
  readonly integrationKey: string;
  /**
   * Logical key referencing an entry in `authorizers`. When set, the route's
   * `AuthorizationType`/`AuthorizerId` are derived from that authorizer's
   * `type`. Ignored when `openApiBody` is set — attach authorizers to spec
   * routes via `x-amazon-apigateway-authorizer` instead.
   *
   * A key that doesn't resolve to an entry in `authorizers` is a
   * configuration error and fails synthesis, rather than silently falling
   * through to an unauthenticated route.
   */
  readonly authorizerKey?: string;
  readonly operationName?: string;
}

export interface HttpApiIntegration {
  readonly type: string;
  readonly uri?: string;
  readonly credentialsArn?: string;
  readonly method?: string;
  readonly payloadFormatVersion?: string;
}

export interface HttpApiAuthorizer {
  /** Authorizer type. An unrecognized value fails synthesis. */
  readonly type: 'JWT' | 'LAMBDA' | 'NONE';
  /** JWT issuer URL. Required when `type` is 'JWT'. */
  readonly jwtIssuer?: string;
  /** JWT audience list. Required when `type` is 'JWT'. */
  readonly jwtAudience?: string[];
  /**
   * Lambda authorizer invoke ARN, e.g.
   * `arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{functionArn}/invocations`
   * — passed straight through to the authorizer resource, same convention as
   * `HttpApiIntegration.uri`. Required when `type` is 'LAMBDA'.
   */
  readonly lambdaArn?: string;
  /**
   * Identity source expressions (e.g. `$request.header.Authorization`).
   * Defaults to `['$request.header.Authorization']` for both 'JWT' and
   * 'LAMBDA' types. Ignored for 'NONE'.
   */
  readonly identitySources?: string[];
}

export interface HttpApiVpcLink {
  readonly subnetIds: string[];
  readonly securityGroupIds?: string[];
}

export interface HttpApiCorsConfig {
  readonly allowOrigins?: string[];
  readonly allowMethods?: string[];
  readonly allowHeaders?: string[];
  readonly exposeHeaders?: string[];
  readonly maxAge?: number;
  readonly allowCredentials?: boolean;
}

export interface HttpApiStageConfig {
  readonly stageName: string;
  readonly autoDeploy?: boolean;
}

export interface HttpApiGatewayProps {
  readonly context: Context;
  readonly description?: string;
  readonly disableExecuteApiEndpoint?: boolean;
  readonly apiVersion?: string;
  readonly corsConfiguration?: HttpApiCorsConfig;
  readonly routes?: Record<string, HttpApiRoute>;
  readonly integrations?: Record<string, HttpApiIntegration>;
  /**
   * Authorizer definitions. Key: logical name, referenced by a route's
   * `authorizerKey`. Only wired up for imperative `routes` — ignored when
   * `openApiBody` is set (spec routes declare their own authorizers).
   */
  readonly authorizers?: Record<string, HttpApiAuthorizer>;
  readonly vpcLinks?: Record<string, HttpApiVpcLink>;
  readonly dnsName?: string;
  readonly route53ZoneIds?: string[];
  readonly acmCertificateArn?: string;
  readonly enableAutoDeploy?: boolean;
  readonly stageVariables?: Record<string, string>;
  readonly accessLoggingEnabled?: boolean;
  readonly accessLogFormat?: string;
  readonly cloudwatchLogsRetentionDays?: number;
  /** Pre-parsed OpenAPI 3.x spec object. When provided, routes and integrations
   *  are sourced from the spec; the `routes` and `integrations` props are ignored. */
  readonly openApiBody?: object;
  /** Additional stages to create (e.g., prod, staging). $default stage is always created. */
  readonly stages?: HttpApiStageConfig[];
}
