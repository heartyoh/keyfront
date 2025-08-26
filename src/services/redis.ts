import Redis from 'ioredis';
import { UserSession } from '@/types/auth';

export class RedisService {
  private redis: Redis;
  private readonly sessionPrefix = 'sess:';
  private readonly rateLimitPrefix = 'ratelimit:';
  private readonly csrfPrefix = 'csrf:';
  private readonly oauthPrefix = 'oauth:';

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      console.log('Connected to Redis');
    });
  }

  // Session Management
  async setSession(sessionId: string, session: UserSession, ttl: number = 3600): Promise<void> {
    const key = `${this.sessionPrefix}${sessionId}`;
    await this.redis.setex(key, ttl, JSON.stringify(session));
  }

  async getSession(sessionId: string): Promise<UserSession | null> {
    const key = `${this.sessionPrefix}${sessionId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    
    try {
      return JSON.parse(data) as UserSession;
    } catch (error) {
      console.error('Failed to parse session data:', error);
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `${this.sessionPrefix}${sessionId}`;
    await this.redis.del(key);
  }

  async updateSessionActivity(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      await this.setSession(sessionId, session);
    }
  }

  // Rate Limiting
  async incrementRateLimit(key: string, windowMs: number): Promise<number> {
    const rateKey = `${this.rateLimitPrefix}${key}:${Math.floor(Date.now() / windowMs)}`;
    const count = await this.redis.incr(rateKey);
    await this.redis.expire(rateKey, Math.ceil(windowMs / 1000));
    return count;
  }

  async getRateLimit(key: string, windowMs: number): Promise<number> {
    const rateKey = `${this.rateLimitPrefix}${key}:${Math.floor(Date.now() / windowMs)}`;
    const count = await this.redis.get(rateKey);
    return count ? parseInt(count) : 0;
  }

  // CSRF Protection
  async setCSRFToken(sessionId: string, token: string, ttl: number = 3600): Promise<void> {
    const key = `${this.csrfPrefix}${sessionId}`;
    await this.redis.setex(key, ttl, token);
  }

  async getCSRFToken(sessionId: string): Promise<string | null> {
    const key = `${this.csrfPrefix}${sessionId}`;
    return await this.redis.get(key);
  }

  async validateCSRFToken(sessionId: string, token: string): Promise<boolean> {
    const storedToken = await this.getCSRFToken(sessionId);
    return storedToken === token;
  }

  // OAuth State Management
  async setOAuthState(state: string, data: any, ttl: number = 300): Promise<void> {
    const key = `${this.oauthPrefix}state:${state}`;
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  async getOAuthState(state: string): Promise<any> {
    const key = `${this.oauthPrefix}state:${state}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    
    try {
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to parse OAuth state data:', error);
      return null;
    }
  }

  async deleteOAuthState(state: string): Promise<void> {
    const key = `${this.oauthPrefix}state:${state}`;
    await this.redis.del(key);
  }

  // Health Check
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis ping failed:', error);
      return false;
    }
  }

  // Cleanup expired sessions
  async cleanupExpiredSessions(): Promise<number> {
    const pattern = `${this.sessionPrefix}*`;
    const keys = await this.redis.keys(pattern);
    let deletedCount = 0;

    for (const key of keys) {
      const session = await this.getSession(key.replace(this.sessionPrefix, ''));
      if (session && session.expiresAt < Date.now()) {
        await this.redis.del(key);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  // Queue operations for audit logging
  async pushToQueue(queueKey: string, items: string[]): Promise<number> {
    if (items.length === 0) return 0;
    return await this.redis.lpush(queueKey, ...items);
  }

  async getFromQueue(queueKey: string, count: number = 100): Promise<string[]> {
    return await this.redis.lrange(queueKey, 0, count - 1);
  }

  async popFromQueue(queueKey: string): Promise<string | null> {
    return await this.redis.rpop(queueKey);
  }

  async getQueueLength(queueKey: string): Promise<number> {
    return await this.redis.llen(queueKey);
  }

  async trimQueue(queueKey: string, maxLength: number): Promise<void> {
    await this.redis.ltrim(queueKey, 0, maxLength - 1);
  }

  // Pipeline operations for rate limiting
  pipeline() {
    return this.redis.pipeline();
  }

  // Execute multiple redis commands atomically
  async multi(commands: Array<{ command: string; args: any[] }>) {
    const pipeline = this.redis.pipeline();
    commands.forEach(({ command, args }) => {
      (pipeline as any)[command](...args);
    });
    return await pipeline.exec();
  }

  // Get keys by pattern
  async getKeysByPattern(pattern: string): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  // Delete multiple keys
  async deleteMultiple(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return await this.redis.del(...keys);
  }

  // Generic Redis operations
  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.setex(key, ttl, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async delete(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  // Close connection
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// Singleton instance
export const redisService = new RedisService();
