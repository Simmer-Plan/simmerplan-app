// Copyright 2026 Dave LeBlanc
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateContinuousBackupsCommand,
  UpdateTableCommand,
  ResourceNotFoundException,
  TableStatus,
} from '@aws-sdk/client-dynamodb';

const region = process.env.AWS_REGION;
const tableName = process.env.DYNAMODB_TABLE;
const environment = process.env.ENVIRONMENT;

if (!region || !tableName || !environment) {
  console.error('Missing required environment variables: AWS_REGION, DYNAMODB_TABLE, ENVIRONMENT');
  process.exit(1);
}

const client = new DynamoDBClient({ region });
const isProd = environment === 'prod';

async function waitForActive(maxWaitSeconds = 60): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitSeconds * 1000) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (Table?.TableStatus === TableStatus.ACTIVE) return;
    console.log(`  Table status: ${Table?.TableStatus} — waiting...`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Table did not become ACTIVE within ${maxWaitSeconds}s`);
}

async function scaffold(): Promise<void> {
  try {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table "${tableName}" already exists (status: ${Table?.TableStatus}) — skipping creation.`);
    if (Table?.TableStatus !== TableStatus.ACTIVE) {
      await waitForActive();
    }
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  console.log(`Creating table "${tableName}"...`);
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      Tags: [
        { Key: 'Project', Value: 'simmerplan' },
        { Key: 'Environment', Value: environment },
        { Key: 'ManagedBy', Value: 'script' },
      ],
    }),
  );

  console.log('Waiting for table to become ACTIVE...');
  await waitForActive();

  if (isProd) {
    console.log('Enabling deletion protection (prod)...');
    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        DeletionProtectionEnabled: true,
      }),
    );

    console.log('Enabling point-in-time recovery (prod)...');
    await client.send(
      new UpdateContinuousBackupsCommand({
        TableName: tableName,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      }),
    );
  }

  const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
  console.log(`\n✅ Table created successfully.`);
  console.log(`   Name: ${Table?.TableName}`);
  console.log(`   ARN:  ${Table?.TableARN}`);
  console.log(`   GSIs: ${Table?.GlobalSecondaryIndexes?.map(g => g.IndexName).join(', ')}`);
}

scaffold().catch(err => {
  console.error('Scaffold failed:', err);
  process.exit(1);
});
