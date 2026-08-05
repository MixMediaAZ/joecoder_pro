import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSION_COOKIE,
  constantTimeEqual,
  makeSession,
  parseCookies,
  sessionCookie
} from './sessionSecurity.js';

test('session cookie is opaque, HttpOnly, host-only, strict, and API-scoped', () => {
  const session = makeSession();
  const cookie = sessionCookie(session.token, false);
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.match(session.csrfToken, /^[a-f0-9]{64}$/);
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api/);
  assert.doesNotMatch(cookie, /Domain=/);
});

test('cookie parsing and constant-time token comparison reject mismatches', () => {
  assert.deepEqual(parseCookies('a=1; jc_session=opaque%20token'), {
    a: '1',
    jc_session: 'opaque token'
  });
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'different'), false);
});
