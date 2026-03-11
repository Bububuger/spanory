import test from 'node:test';
import assert from 'node:assert/strict';

import { calibratedEstimate, calibrate, estimateTokens } from '../dist/index.js';

test('estimateTokens supports content-type heuristics', () => {
  assert.equal(estimateTokens('你好世界，这是一个测试'), 7);
  assert.equal(estimateTokens('{"key":"value","nested":{"a":1}}'), 13);
  assert.equal(estimateTokens('Hello world'), 3);
});

test('calibration updates EMA and calibrates estimate after enough anchors', () => {
  let state = { ema: 1, sampleCount: 0 };
  state = calibrate(state, 120, 100);
  state = calibrate(state, 100, 100);
  state = calibrate(state, 90, 100);

  const calibrated = calibratedEstimate(100, state);
  assert.equal(state.sampleCount, 3);
  assert.equal(calibrated, 100);
});

test('calibrated estimate reduces CJK heuristic error within 15% after anchors', () => {
  const text = '你好世界，这是一个测试';
  const raw = estimateTokens(text);
  assert.equal(raw, 7);

  let state = { ema: 1, sampleCount: 0 };
  state = calibrate(state, 14, raw);
  state = calibrate(state, 13, raw);
  state = calibrate(state, 15, raw);

  const calibrated = calibratedEstimate(raw, state);
  const target = 14;
  const relativeError = Math.abs(calibrated - target) / target;
  assert.equal(state.sampleCount, 3);
  assert.equal(calibrated, 12);
  assert.ok(relativeError <= 0.15);
});
