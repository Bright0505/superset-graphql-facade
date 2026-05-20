// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

// Sliding-window rate limiter (per API key, 1-minute window).
// Uses in-memory storage — resets on process restart.

const windows = new Map<string, number[]>();

/**
 * Returns true if the request is within the allowed rate.
 * Mutates internal state (records the current timestamp).
 */
export function checkRateLimit(key: string, rpm: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const prev = windows.get(key) ?? [];
  const current = prev.filter((t) => t > windowStart);

  if (current.length >= rpm) return false;

  current.push(now);
  windows.set(key, current);
  return true;
}

/** Returns remaining requests in current window for the given key. */
export function getRateLimitRemaining(key: string, rpm: number): number {
  const now = Date.now();
  const windowStart = now - 60_000;
  const current = (windows.get(key) ?? []).filter((t) => t > windowStart);
  return Math.max(0, rpm - current.length);
}
