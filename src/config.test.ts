// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { parseScopeCredentials } from './config.js';

describe('parseScopeCredentials', () => {
  test('空 JSON {} 回空 Map', () => {
    expect(parseScopeCredentials('{}').size).toBe(0);
  });

  test('正常解析一組憑證', () => {
    const m = parseScopeCredentials('{"中投一區": "scope_ztyi1:secret"}');
    expect(m.get('中投一區')).toEqual({ username: 'scope_ztyi1', password: 'secret' });
  });

  test('解析多組憑證', () => {
    const m = parseScopeCredentials('{"中投一區": "u1:p1", "商場一部": "u2:p2"}');
    expect(m.size).toBe(2);
    expect(m.get('商場一部')).toEqual({ username: 'u2', password: 'p2' });
  });

  test('密碼中含冒號：只切第一個冒號', () => {
    const m = parseScopeCredentials('{"scope": "user:pass:with:colons"}');
    expect(m.get('scope')).toEqual({ username: 'user', password: 'pass:with:colons' });
  });

  test('格式不符（無冒號）跳過', () => {
    const m = parseScopeCredentials('{"bad": "nocolon"}');
    expect(m.size).toBe(0);
  });

  test('無效 JSON 回空 Map', () => {
    expect(parseScopeCredentials('NOT JSON').size).toBe(0);
  });

  test('空字串回空 Map', () => {
    expect(parseScopeCredentials('').size).toBe(0);
  });

  test('value 型別非字串的 key 被跳過', () => {
    const m = parseScopeCredentials('{"k1": 123, "k2": "u:p"}');
    expect(m.size).toBe(1);
    expect(m.get('k2')).toEqual({ username: 'u', password: 'p' });
  });
});
