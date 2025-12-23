import { test, expect } from 'bun:test';
import { initializeSession, sessionReducer } from './session';

test('initializeSession creates empty session', () => {
  const session = initializeSession();
  expect(session).toEqual({
    statements: [],
    liveStatementIndex: null,
    ratifiedOrder: []
  });
});

test('ADD_STATEMENT adds a statement to the session', () => {
  const session = initializeSession();
  const action = {
    type: 'ADD_STATEMENT' as const,
    payload: {
      text: 'We should go to the moon!',
      createdBy: 'user_123',
      presentUsers: ['user_123', 'user_234']
    }
  };

  const newSession = sessionReducer(session, action);

  expect(newSession.statements).toHaveLength(1);
  expect(newSession.statements[0].text).toBe('We should go to the moon!');
  expect(newSession.statements[0].createdBy).toBe('user_123');
  expect(newSession.statements[0].present).toEqual(['user_123', 'user_234']);
  expect(newSession.statements[0].responses).toEqual({});
});

test('RESPOND_TO_STATEMENT adds user response', () => {
  let session = initializeSession();

  // Add a statement first
  session = sessionReducer(session, {
    type: 'ADD_STATEMENT',
    payload: {
      text: 'We should go to the moon!',
      createdBy: 'user_123',
      presentUsers: ['user_123', 'user_234']
    }
  });

  // User responds to the statement
  const responseAction = {
    type: 'RESPOND_TO_STATEMENT' as const,
    payload: {
      statementIndex: 0,
      userId: 'user_123',
      response: true
    }
  };

  const newSession = sessionReducer(session, responseAction);

  expect(newSession.statements[0].responses).toEqual({
    'user_123': true
  });
});

test('RESPOND_TO_STATEMENT allows multiple user responses', () => {
  let session = initializeSession();

  // Add a statement
  session = sessionReducer(session, {
    type: 'ADD_STATEMENT',
    payload: {
      text: 'We should go to the moon!',
      createdBy: 'user_123',
      presentUsers: ['user_123', 'user_234']
    }
  });

  // First user responds
  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 0,
      userId: 'user_123',
      response: true
    }
  });

  // Second user responds
  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 0,
      userId: 'user_234',
      response: false
    }
  });

  expect(session.statements[0].responses).toEqual({
    'user_123': true,
    'user_234': false
  });
});

test('RESPOND_TO_STATEMENT can update existing user response', () => {
  let session = initializeSession();

  // Add a statement
  session = sessionReducer(session, {
    type: 'ADD_STATEMENT',
    payload: {
      text: 'We should go to the moon!',
      createdBy: 'user_123',
      presentUsers: ['user_123', 'user_234']
    }
  });

  // User responds
  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 0,
      userId: 'user_123',
      response: true
    }
  });

  // Same user changes their mind
  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 0,
      userId: 'user_123',
      response: false
    }
  });

  expect(session.statements[0].responses).toEqual({
    'user_123': false
  });
});

test('RESPOND_TO_STATEMENT throws error for invalid statement index', () => {
  const session = initializeSession();

  expect(() => {
    sessionReducer(session, {
      type: 'RESPOND_TO_STATEMENT',
      payload: {
        statementIndex: 0,
        userId: 'user_123',
        response: true
      }
    });
  }).toThrow('Invalid statement index');
});

test('multiple statements work correctly', () => {
  let session = initializeSession();

  // Add multiple statements
  session = sessionReducer(session, {
    type: 'ADD_STATEMENT',
    payload: {
      text: 'We should go to the moon!',
      createdBy: 'user_123',
      presentUsers: ['user_123', 'user_234']
    }
  });

  session = sessionReducer(session, {
    type: 'ADD_STATEMENT',
    payload: {
      text: 'Mars is better than the moon!',
      createdBy: 'user_456',
      presentUsers: ['user_123', 'user_456']
    }
  });

  // Respond to different statements
  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 0,
      userId: 'user_123',
      response: true
    }
  });

  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 1,
      userId: 'user_123',
      response: false
    }
  });

  expect(session.statements).toHaveLength(2);
  expect(session.statements[0].responses).toEqual({ 'user_123': true });
  expect(session.statements[1].responses).toEqual({ 'user_123': false });
});

test('UPDATE_UNRESOLVED_STATEMENTS never removes statement creator when they leave', () => {
  let session = initializeSession();

  // Add a statement created by user_123
  session = sessionReducer(session, {
    type: 'ADD_STATEMENT',
    payload: {
      text: 'We should go to the moon!',
      createdBy: 'user_123',
      presentUsers: ['user_123', 'user_234', 'user_456']
    }
  });

  // user_123 responds to their own statement
  session = sessionReducer(session, {
    type: 'RESPOND_TO_STATEMENT',
    payload: {
      statementIndex: 0,
      userId: 'user_123',
      response: true
    }
  });

  // Try to remove the creator (user_123) when they "leave"
  session = sessionReducer(session, {
    type: 'UPDATE_UNRESOLVED_STATEMENTS',
    payload: {
      userId: 'user_123',
      action: 'remove'
    }
  });

  // Creator should still be in present array and responses should remain
  expect(session.statements[0].present).toContain('user_123');
  expect(session.statements[0].responses['user_123']).toBe(true);

  // But other users should be removable
  session = sessionReducer(session, {
    type: 'UPDATE_UNRESOLVED_STATEMENTS',
    payload: {
      userId: 'user_234',
      action: 'remove'
    }
  });

  expect(session.statements[0].present).not.toContain('user_234');
  expect(session.statements[0].present).toContain('user_123'); // Creator still there
});