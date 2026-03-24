// ============================================================================
// Open Posting — Circuit Breaker
// ============================================================================

import { CIRCUIT_BREAKER } from '@open-posting/shared';
import type { Logger } from '../logger.js';

type CircuitState = 'closed' | 'half-open' | 'open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenAttempts: number = 0;

  constructor(
    private readonly name: string,
    private readonly logger: Logger,
    private readonly config = CIRCUIT_BREAKER,
  ) {}

  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  isAvailable(): boolean {
    this.checkStateTransition();
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return this.halfOpenAttempts < this.config.halfOpenMaxAttempts;
    return false;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.logger.info({ circuit: this.name }, 'Circuit breaker closed after successful half-open attempt');
    }
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenAttempts = 0;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.state = 'open';
        this.logger.warn({ circuit: this.name, failures: this.failures }, 'Circuit breaker opened (half-open failures exceeded)');
      }
      return;
    }

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      this.logger.warn({ circuit: this.name, failures: this.failures }, 'Circuit breaker opened');
    }
  }

  private checkStateTransition(): void {
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
      this.state = 'half-open';
      this.halfOpenAttempts = 0;
      this.logger.info({ circuit: this.name }, 'Circuit breaker transitioning to half-open');
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error(`Circuit breaker ${this.name} is open`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}
