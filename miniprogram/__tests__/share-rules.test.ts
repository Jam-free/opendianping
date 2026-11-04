import { describe, it, expect } from '@jest/globals';
import { selectShareCircle } from '../client/utils/share-circle.ts';

describe('Share Rules', () => {
  describe('SH-1: With multiple circles, share the earliest one joined', () => {
    it('should select the circle with the earliest joined_at timestamp', () => {
      const circles = [
        { 
          id: 'circle-2', 
          name: 'Circle 2',
          is_personal: 0, 
          joined_at: '2024-01-15T10:00:00Z',
          invite_token: 'token-2',
          token_expires_at: '2025-01-15T10:00:00Z'
        },
        { 
          id: 'circle-1', 
          name: 'Circle 1',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-1',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
        { 
          id: 'circle-3', 
          name: 'Circle 3',
          is_personal: 0, 
          joined_at: '2024-01-20T10:00:00Z',
          invite_token: 'token-3',
          token_expires_at: '2025-01-20T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles);
      expect(result?.id).toBe('circle-1');
    });

    it('should use circle id as tie-breaker when joined_at is identical', () => {
      const circles = [
        { 
          id: 'circle-c', 
          name: 'Circle C',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-c',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
        { 
          id: 'circle-a', 
          name: 'Circle A',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-a',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
        { 
          id: 'circle-b', 
          name: 'Circle B',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-b',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles);
      expect(result?.id).toBe('circle-a');
    });

    it('should exclude personal spaces from selection', () => {
      const circles = [
        { 
          id: 'personal', 
          name: 'Personal Space',
          is_personal: 1, 
          joined_at: '2024-01-05T10:00:00Z',
          invite_token: 'personal-token',
          token_expires_at: '2025-01-05T10:00:00Z'
        },
        { 
          id: 'circle-2', 
          name: 'Circle 2',
          is_personal: 0, 
          joined_at: '2024-01-15T10:00:00Z',
          invite_token: 'token-2',
          token_expires_at: '2025-01-15T10:00:00Z'
        },
        { 
          id: 'circle-1', 
          name: 'Circle 1',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-1',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles);
      expect(result?.id).toBe('circle-1');
    });
  });

  describe('SH-2: With only a personal space, no share', () => {
    it('should return null when user has only a personal space', () => {
      const circles = [
        { 
          id: 'personal', 
          name: 'Personal Space',
          is_personal: 1, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'personal-token',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles);
      expect(result).toBeNull();
    });

    it('should return null when user has no circles at all', () => {
      const circles: Array<{ 
        id: string; 
        name: string;
        is_personal: number; 
        joined_at: string;
        invite_token: string;
        token_expires_at: string;
      }> = [];

      const result = selectShareCircle(circles);
      expect(result).toBeNull();
    });
  });

  describe('SH-3: On circle-detail page, share the current circle', () => {
    it('should return the current circle when provided and it is a shared circle', () => {
      const circles = [
        { 
          id: 'circle-1', 
          name: 'Circle 1',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-1',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
        { 
          id: 'circle-2', 
          name: 'Circle 2',
          is_personal: 0, 
          joined_at: '2024-01-05T10:00:00Z',
          invite_token: 'token-2',
          token_expires_at: '2025-01-05T10:00:00Z'
        },
        { 
          id: 'circle-3', 
          name: 'Circle 3',
          is_personal: 0, 
          joined_at: '2024-01-15T10:00:00Z',
          invite_token: 'token-3',
          token_expires_at: '2025-01-15T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles, 'circle-3');
      expect(result?.id).toBe('circle-3');
    });

    it('should fall back to earliest joined when current circle is personal', () => {
      const circles = [
        { 
          id: 'personal', 
          name: 'Personal Space',
          is_personal: 1, 
          joined_at: '2024-01-05T10:00:00Z',
          invite_token: 'personal-token',
          token_expires_at: '2025-01-05T10:00:00Z'
        },
        { 
          id: 'circle-1', 
          name: 'Circle 1',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-1',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
        { 
          id: 'circle-2', 
          name: 'Circle 2',
          is_personal: 0, 
          joined_at: '2024-01-15T10:00:00Z',
          invite_token: 'token-2',
          token_expires_at: '2025-01-15T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles, 'personal');
      expect(result?.id).toBe('circle-1');
    });

    it('should fall back to earliest joined when current circle is not in the list', () => {
      const circles = [
        { 
          id: 'circle-1', 
          name: 'Circle 1',
          is_personal: 0, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'token-1',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
        { 
          id: 'circle-2', 
          name: 'Circle 2',
          is_personal: 0, 
          joined_at: '2024-01-15T10:00:00Z',
          invite_token: 'token-2',
          token_expires_at: '2025-01-15T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles, 'circle-999');
      expect(result?.id).toBe('circle-1');
    });

    it('should return null when current circle is personal and no other shared circles exist', () => {
      const circles = [
        { 
          id: 'personal', 
          name: 'Personal Space',
          is_personal: 1, 
          joined_at: '2024-01-10T10:00:00Z',
          invite_token: 'personal-token',
          token_expires_at: '2025-01-10T10:00:00Z'
        },
      ];

      const result = selectShareCircle(circles, 'personal');
      expect(result).toBeNull();
    });
  });
});
