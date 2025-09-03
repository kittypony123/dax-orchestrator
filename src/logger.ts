import * as fs from 'fs/promises';
import * as path from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: string;
  metadata?: Record<string, unknown>;
  error?: Error;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logFilePath?: string;
  maxFileSize?: number; // in bytes
  maxFiles?: number;
  format?: 'json' | 'text';
}

export class Logger {
  private config: LoggerConfig;
  private logQueue: LogEntry[] = [];
  private isWriting = false;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: this.parseLogLevel(process.env.LOG_LEVEL) || LogLevel.INFO,
      enableConsole: process.env.NODE_ENV !== 'test',
      enableFile: true,
      logFilePath: path.join(process.cwd(), 'logs', 'dax-catalog.log'),
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: 'json',
      ...config,
    };

    // Ensure log directory exists
    this.ensureLogDirectory().catch(error => {
      console.error('Failed to create log directory:', error);
    });
  }

  private parseLogLevel(level?: string): LogLevel | undefined {
    if (!level) return undefined;
    const upperLevel = level.toUpperCase();
    return LogLevel[upperLevel as keyof typeof LogLevel];
  }

  private async ensureLogDirectory(): Promise<void> {
    if (this.config.logFilePath) {
      const logDir = path.dirname(this.config.logFilePath);
      try {
        await fs.access(logDir);
      } catch {
        await fs.mkdir(logDir, { recursive: true });
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.config.level;
  }

  private formatMessage(entry: LogEntry): string {
    if (this.config.format === 'json') {
      return JSON.stringify({
        timestamp: entry.timestamp.toISOString(),
        level: LogLevel[entry.level],
        message: entry.message,
        context: entry.context,
        metadata: entry.metadata,
        error: entry.error ? {
          name: entry.error.name,
          message: entry.error.message,
          stack: entry.error.stack,
        } : undefined,
      });
    } else {
      const timestamp = entry.timestamp.toISOString();
      const level = LogLevel[entry.level].padEnd(5);
      const context = entry.context ? `[${entry.context}] ` : '';
      const metadata = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
      const error = entry.error ? `\nError: ${entry.error.stack}` : '';
      return `${timestamp} ${level} ${context}${entry.message}${metadata}${error}`;
    }
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    if (!this.config.enableFile || !this.config.logFilePath) return;

    const message = this.formatMessage(entry) + '\n';
    
    try {
      // Check file size and rotate if necessary
      await this.rotateLogIfNeeded();
      
      // Append to log file
      await fs.appendFile(this.config.logFilePath, message);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private async rotateLogIfNeeded(): Promise<void> {
    if (!this.config.logFilePath || !this.config.maxFileSize) return;

    try {
      const stats = await fs.stat(this.config.logFilePath);
      if (stats.size >= this.config.maxFileSize) {
        await this.rotateLogs();
      }
    } catch (error) {
      // File doesn't exist yet, which is fine
    }
  }

  private async rotateLogs(): Promise<void> {
    if (!this.config.logFilePath || !this.config.maxFiles) return;

    const logDir = path.dirname(this.config.logFilePath);
    const logName = path.basename(this.config.logFilePath, '.log');
    
    try {
      // Rotate existing log files
      for (let i = this.config.maxFiles - 1; i > 0; i--) {
        const oldFile = path.join(logDir, `${logName}.${i}.log`);
        const newFile = path.join(logDir, `${logName}.${i + 1}.log`);
        
        try {
          await fs.rename(oldFile, newFile);
        } catch {
          // File doesn't exist, continue
        }
      }
      
      // Move current log to .1
      const firstRotated = path.join(logDir, `${logName}.1.log`);
      await fs.rename(this.config.logFilePath, firstRotated);
      
      // Remove oldest log file
      const oldestFile = path.join(logDir, `${logName}.${this.config.maxFiles}.log`);
      try {
        await fs.unlink(oldestFile);
      } catch {
        // File doesn't exist, which is fine
      }
    } catch (error) {
      console.error('Failed to rotate logs:', error);
    }
  }

  private logToConsole(entry: LogEntry): void {
    if (!this.config.enableConsole) return;

    const message = entry.context ? `[${entry.context}] ${entry.message}` : entry.message;
    const metadata = entry.metadata ? entry.metadata : undefined;

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(`❌ ${message}`, metadata, entry.error);
        break;
      case LogLevel.WARN:
        console.warn(`⚠️  ${message}`, metadata);
        break;
      case LogLevel.INFO:
        console.info(`ℹ️  ${message}`, metadata);
        break;
      case LogLevel.DEBUG:
        console.debug(`🐛 ${message}`, metadata);
        break;
      case LogLevel.TRACE:
        console.trace(`🔍 ${message}`, metadata);
        break;
    }
  }

  private async processLogQueue(): Promise<void> {
    if (this.isWriting || this.logQueue.length === 0) return;
    
    this.isWriting = true;
    
    try {
      const entries = [...this.logQueue];
      this.logQueue = [];
      
      for (const entry of entries) {
        await this.writeToFile(entry);
      }
    } catch (error) {
      console.error('Failed to process log queue:', error);
    } finally {
      this.isWriting = false;
    }
  }

  private async log(
    level: LogLevel,
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): Promise<void> {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context,
      metadata,
      error,
    };

    // Log to console immediately
    this.logToConsole(entry);

    // Queue for file writing
    if (this.config.enableFile) {
      this.logQueue.push(entry);
      // Process queue asynchronously
      void this.processLogQueue();
    }
  }

  // Public logging methods
  async error(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): Promise<void> {
    return this.log(LogLevel.ERROR, message, context, metadata, error);
  }

  async warn(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log(LogLevel.WARN, message, context, metadata);
  }

  async info(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log(LogLevel.INFO, message, context, metadata);
  }

  async debug(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log(LogLevel.DEBUG, message, context, metadata);
  }

  async trace(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log(LogLevel.TRACE, message, context, metadata);
  }

  // Utility methods for different contexts
  createChildLogger(context: string): ChildLogger {
    return new ChildLogger(this, context);
  }

  async flush(): Promise<void> {
    // Wait for all queued logs to be written
    while (this.logQueue.length > 0 || this.isWriting) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  // Update log level at runtime
  setLogLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

export class ChildLogger {
  constructor(
    private parent: Logger,
    private context: string
  ) {}

  async error(
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): Promise<void> {
    return this.parent.error(message, this.context, metadata, error);
  }

  async warn(
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.parent.warn(message, this.context, metadata);
  }

  async info(
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.parent.info(message, this.context, metadata);
  }

  async debug(
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.parent.debug(message, this.context, metadata);
  }

  async trace(
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.parent.trace(message, this.context, metadata);
  }
}

// Create default logger instance
export const logger = new Logger();

// Export convenience functions
export const createLogger = (config?: Partial<LoggerConfig>): Logger => 
  new Logger(config);

export const getLogger = (context: string) => logger.createChildLogger(context);