'use client';

import { nanoid } from 'nanoid';
import { useState, useEffect } from 'react';

const USER_ID_KEY = 'resonance-user-id';

export function useUserId() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = nanoid();
      localStorage.setItem(USER_ID_KEY, id);
    }
    setUserId(id);
  }, []);

  return userId;
}