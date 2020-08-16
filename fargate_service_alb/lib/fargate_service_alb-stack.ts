// import {CfnMesh, CfnRoute, CfnVirtualNode, CfnVirtualRouter, CfnVirtualService} from "@aws-cdk/aws-appmesh";
import {Port, SecurityGroup, SubnetType, Vpc} from "@aws-cdk/aws-ec2";
import {Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDriver, Protocol} from "@aws-cdk/aws-ecs";
import {CfnTaskDefinition, ContainerDependencyCondition} from "@aws-cdk/aws-ecs";
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import {ManagedPolicy, Role, ServicePrincipal} from "@aws-cdk/aws-iam";
import {LogGroup, RetentionDays} from "@aws-cdk/aws-logs";
import {CfnOutput, Construct, Duration, RemovalPolicy, Stack, StackProps, Fn} from "@aws-cdk/core";
/**
 * Deploys the resources necessary to demo the Color App *before* and *after* enabling App Mesh.
 * This stack deploys
 * - a vpc with private subnets in 2 AZs, and a public ALB
 * - the Color App (a gateway and two colorteller (blue & green) services)
 * - an App Mesh mesh (ready to go for mesh-enabling the app)
 */
export class FargateServiceAlbStack extends Stack {
  // Demo customization
  //
  // Gateway
  // - your own image on Docker Hub or ECR for your own account
  readonly demoImage = "487213271675.dkr.ecr.us-east-1.amazonaws.com/demo-app:latest";
  // Gateway and ColorTeller server port
  readonly APP_PORT = 8080;
   // might want to experiment with different ttl during testing
  readonly DEF_TTL = Duration.seconds(10);
  //
  // end: Demo customization
  stackName: string;
  taskRole: Role;
  taskExecutionRole: Role;
  vpc: any;
  cluster: Cluster;
  internalSecurityGroup: SecurityGroup;
  externalSecurityGroup: SecurityGroup;
  logGroup: LogGroup;
  //mesh: CfnMesh;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    // store for convenience
    this.stackName = props && props.stackName ? props.stackName : "demo";
    this.createLogGroup();
    this.createVPC();
    this.createCluster();
    this.createDemo();
  }
  createLogGroup() {
    this.logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: this.stackName,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  createVPC() {
    // this.vpc = Vpc.fromVpcAttributes(this, 'sandbox-vpc1', {
    //   vpcId: 'vpc-a46a7bdf',
    //   availabilityZones: [ 'us-east-1a', 'us-east-1b' ],
    //   publicSubnetIds: [ 'subnet-06ca1d5a', 'subnet-6225f505' ],
    //   privateSubnetIds: [ 'subnet-39c31465', 'subnet-2b50804c' ],
    // });
    var vpc;
    vpc = new Vpc(this, 'Vpc', { maxAzs: 2 });
    // Allow public inbound web traffic on port 80
    this.externalSecurityGroup = new SecurityGroup(this, "ExternalSG", {
      vpc: this.vpc,
      allowAllOutbound: true,
    });
    this.externalSecurityGroup.connections.allowFromAnyIpv4(Port.tcp(80));
    // Allow communication within the vpc for the app and envoy containers
    // inbound 8080, 9901, 15000; all outbound
    // - 8080: default app port for gateway and colorteller
    // - 9901: envoy admin interface, used for health check
    // - 15000: envoy ingress ports (egress over 15001 will be allowed by allowAllOutbound)
    this.internalSecurityGroup = new SecurityGroup(this, "InternalSG", {
      vpc: this.vpc,
      allowAllOutbound: true,
    });
    [Port.tcp(this.APP_PORT), Port.tcp(9901), Port.tcp(15000)].forEach(port => {
      this.internalSecurityGroup.connections.allowInternally(port);
    });
  }


  createCluster() {
    // Deploy a Fargate cluster on ECS
    this.cluster = new Cluster(this, "Cluster", {
      vpc: this.vpc
    });

    // we need to ensure the service record is created for after we enable app mesh
    // (there is no resource we create here that will make this happen implicitly
    // since CDK won't all two services to register the same service name in
    // Cloud Map, even though we can discriminate between them using service attributes
    // based on ECS_TASK_DEFINITION_FAMILY
    // grant cloudwatch and xray permissions to IAM task role for color app tasks
    this.taskRole = new Role(this, "TaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess")
      ],
    });
    // grant ECR pull permission to IAM task execution role for ECS agent
    this.taskExecutionRole = new Role(this, "TaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
      ],
    });
    // CDK will print after finished deploying stack
    new CfnOutput(this, "ClusterName", {
      description: "ECS/Fargate cluster name",
      value: this.cluster.clusterName,
    });
  }
  createDemo() {

    let demoTaskDef = new FargateTaskDefinition(this, "demoTaskDef", {
      family: "demoTask",
      taskRole: this.taskRole,
      executionRole: this.taskExecutionRole,
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    let demoContainer = demoTaskDef.addContainer("demoApp", {
      image: ContainerImage.fromRegistry(this.demoImage),
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: "demo",
      }),
    });
    demoContainer.addPortMappings({
      containerPort: this.APP_PORT,
    });



    let demoService = new FargateService(this, "demoService", {
      cluster: this.cluster,
      serviceName: "demo",
      taskDefinition: demoTaskDef,
      desiredCount: 1,
      securityGroup: this.internalSecurityGroup,
      cloudMapOptions: {
        name: "demo",
        dnsTtl: this.DEF_TTL,
      },
    });



    let alb = new elbv2.ApplicationLoadBalancer(this, "PublicALB", {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.externalSecurityGroup,
    });
    let albListener = alb.addListener("demoWeb", {
      port: 80,
    });
    albListener.addTargets("Target", {
      port: 80,
      targets: [demoService],
      healthCheck: {
        path: "/ping",
        port: "traffic-port",
        interval: Duration.seconds(10),
        timeout: Duration.seconds(5),
        "healthyHttpCodes": "200-499",
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
    });
    // CDK will print after finished deploying stack
    new CfnOutput(this, "URL", {
      description: "Demo App URL",
      value: alb.loadBalancerDnsName,
    });
  }


}
