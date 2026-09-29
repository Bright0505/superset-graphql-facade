// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, graphql } from 'graphql';
import { JSONScalar } from './scalars.js';

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      echo: {
        type: JSONScalar,
        args: { val: { type: new GraphQLNonNull(JSONScalar) } },
        resolve: (_parent, args: { val: unknown }) => args.val,
      },
      echoList: {
        type: JSONScalar,
        args: { vals: { type: new GraphQLList(new GraphQLNonNull(JSONScalar)) } },
        resolve: (_parent, args: { vals: unknown[] }) => args.vals,
      },
    },
  }),
});

async function echoLiteral(literal: string): Promise<unknown> {
  const result = await graphql({ schema, source: `{ echo(val: ${literal}) }` });
  expect(result.errors).toBeUndefined();
  return result.data?.echo;
}

test('JSON literal keeps Int values', async () => {
  expect(await echoLiteral('2026')).toBe(2026);
});

test('JSON literal keeps Float values', async () => {
  expect(await echoLiteral('1.5')).toBe(1.5);
});

test('JSON literal keeps Boolean values', async () => {
  expect(await echoLiteral('true')).toBe(true);
});

test('JSON literal keeps List and Object values', async () => {
  expect(await echoLiteral('[1, "a", false]')).toEqual([1, 'a', false]);
  expect(await echoLiteral('{ year: 2026, tags: ["x"] }')).toEqual({ year: 2026, tags: ['x'] });
});

test('JSON string literal is parsed as JSON when valid', async () => {
  expect(await echoLiteral('"9"')).toBe(9);
  expect(await echoLiteral('"[\\"a\\",\\"b\\"]"')).toEqual(['a', 'b']);
});

test('JSON string literal stays a string when not valid JSON', async () => {
  expect(await echoLiteral('"01515"')).toBe('01515');
});

test('JSON literal resolves nested variables', async () => {
  const result = await graphql({
    schema,
    source: 'query ($m: JSON) { echo(val: { month: $m }) }',
    variableValues: { m: 9 },
  });
  expect(result.errors).toBeUndefined();
  expect(result.data?.echo).toEqual({ month: 9 });
});

test('inline literals and variables produce the same values', async () => {
  const values = [2026, 9, '01515'];
  const inline = await graphql({ schema, source: '{ echoList(vals: [2026, 9, "01515"]) }' });
  const viaVariables = await graphql({
    schema,
    source: 'query ($v: [JSON!]) { echoList(vals: $v) }',
    variableValues: { v: values },
  });
  expect(inline.errors).toBeUndefined();
  expect(viaVariables.errors).toBeUndefined();
  expect(inline.data?.echoList).toEqual(values);
  expect(viaVariables.data?.echoList).toEqual(values);
});
