// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { GraphQLScalarType, Kind } from 'graphql';

export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) {
      try { return JSON.parse(ast.value) as unknown; } catch { return ast.value; }
    }
    return null;
  },
});

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO 8601 date-time string',
  serialize: (value) => (value instanceof Date ? value.toISOString() : String(value)),
  parseValue: (value) => new Date(String(value)),
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});
