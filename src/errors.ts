/**
 * Centralized error handling system for DAX Catalog
 */

import { getLogger } from './logger';

const logger = getLogger('ErrorHandler');

export enum ErrorCode {
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_API_KEY = 'MISSING_API_KEY',
  
  // File system errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
  DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // CSV parsing errors
  CSV_PARSE_ERROR = 'CSV_PARSE_ERROR',
  CSV_VALIDATION_ERROR = 'CSV_VALIDATION_ERROR',
  CSV_EMPTY_FILE = 'CSV_EMPTY_FILE',
  CSV_INVALID_HEADERS = 'CSV_INVALID_HEADERS',
  
  // DAX analysis errors
  DAX_ANALYSIS_ERROR = 'DAX_ANALYSIS_ERROR',
  DAX_INVALID_EXPRESSION = 'DAX_INVALID_EXPRESSION',
  DAX_VALIDATION_ERROR = 'DAX_VALIDATION_ERROR',
  
  // Claude API errors
  CLAUDE_API_ERROR = 'CLAUDE_API_ERROR',
  CLAUDE_TIMEOUT = 'CLAUDE_TIMEOUT',
  CLAUDE_RATE_LIMIT = 'CLAUDE_RATE_LIMIT',
  CLAUDE_INVALID_RESPONSE = 'CLAUDE_INVALID_RESPONSE',
  CLAUDE_AUTH_ERROR = 'CLAUDE_AUTH_ERROR',
  
  // Documentation generation errors
  DOC_GENERATION_ERROR = 'DOC_GENERATION_ERROR',
  DOC_TEMPLATE_ERROR = 'DOC_TEMPLATE_ERROR',
  DOC_OUTPUT_ERROR = 'DOC_OUTPUT_ERROR',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  
  // Generic errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  OPERATION_CANCELLED = 'OPERATION_CANCELLED'
}

export interface ErrorContext {
  operation?: string;
  filePath?: string;
  measureName?: string;
  tableName?: string;
  apiRequest?: string;
  userAction?: string;
  additionalData?: Record<string, unknown>;
}

export class DAXCatalogError extends Error {
  public readonly code: ErrorCode;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly isRetryable: boolean;
  public readonly originalError?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    context: ErrorContext = {},
    originalError?: Error,
    isRetryable = false
  ) {
    super(message);
    this.name = 'DAXCatalogError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.isRetryable = isRetryable;
    this.originalError = originalError;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DAXCatalogError);
    }
  }

  /**
   * Create error with user-friendly message
   */
  static createUserFriendly(
    code: ErrorCode,
    userMessage: string,
    technicalMessage: string,
    context: ErrorContext = {},
    originalError?: Error
  ): DAXCatalogError {
    const error = new DAXCatalogError(code, technicalMessage, context, originalError);
    (error as any).userMessage = userMessage;
    return error;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    return (this as any).userMessage || this.message;
  }

  /**
   * Convert error to JSON for logging/API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.getUserMessage(),
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      isRetryable: this.isRetryable,
      stack: this.stack,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined
    };
  }
}

/**
 * Error factory for common error scenarios
 */
export class ErrorFactory {
  
  // File system errors
  static fileNotFound(filePath: string, operation = 'read'): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.FILE_NOT_FOUND,
      `The file "${filePath}" was not found. Please check that the file exists and try again.`,
      `File not found during ${operation} operation: ${filePath}`,
      { operation, filePath }
    );
  }

  static fileReadError(filePath: string, originalError: Error): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.FILE_READ_ERROR,
      `Unable to read the file "${filePath}". Please check file permissions and try again.`,
      `Failed to read file: ${originalError.message}`,
      { operation: 'file_read', filePath },
      originalError
    );
  }

  static fileWriteError(filePath: string, originalError: Error): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.FILE_WRITE_ERROR,
      `Unable to write to "${filePath}". Please check file permissions and available disk space.`,
      `Failed to write file: ${originalError.message}`,
      { operation: 'file_write', filePath },
      originalError
    );
  }

  static directoryNotFound(dirPath: string): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.DIRECTORY_NOT_FOUND,
      `The directory "${dirPath}" does not exist. Please check the path and try again.`,
      `Directory not found: ${dirPath}`,
      { operation: 'directory_access', filePath: dirPath }
    );
  }

  // CSV parsing errors
  static csvParseError(filePath: string, lineNumber?: number, originalError?: Error): DAXCatalogError {
    const context: ErrorContext = { operation: 'csv_parse', filePath };
    if (lineNumber) context.additionalData = { lineNumber };

    return DAXCatalogError.createUserFriendly(
      ErrorCode.CSV_PARSE_ERROR,
      `The CSV file "${filePath}" contains invalid data${lineNumber ? ` at line ${lineNumber}` : ''}. Please check the file format.`,
      `CSV parsing failed: ${originalError?.message || 'Invalid format'}`,
      context,
      originalError
    );
  }

  static csvValidationError(filePath: string, issues: string[]): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.CSV_VALIDATION_ERROR,
      `The CSV file "${filePath}" has validation issues: ${issues.join(', ')}`,
      `CSV validation failed with ${issues.length} issues`,
      { operation: 'csv_validation', filePath, additionalData: { issues } }
    );
  }

  static csvEmptyFile(filePath: string): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.CSV_EMPTY_FILE,
      `The CSV file "${filePath}" is empty or contains no valid data.`,
      `CSV file is empty`,
      { operation: 'csv_parse', filePath }
    );
  }

  // DAX analysis errors
  static daxAnalysisError(measureName: string, originalError: Error): DAXCatalogError {
    const error = DAXCatalogError.createUserFriendly(
      ErrorCode.DAX_ANALYSIS_ERROR,
      `Unable to analyze the DAX measure "${measureName}". The analysis will continue with basic information.`,
      `DAX analysis failed for measure: ${originalError.message}`,
      { operation: 'dax_analysis', measureName },
      originalError
    );
    (error as any).isRetryable = true;
    return error;
  }

  static daxInvalidExpression(measureName: string, expression: string): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.DAX_INVALID_EXPRESSION,
      `The DAX expression for "${measureName}" appears to be invalid or incomplete.`,
      `Invalid DAX expression: ${expression}`,
      { operation: 'dax_validation', measureName, additionalData: { expression } }
    );
  }

  // Claude API errors
  static claudeApiError(originalError: Error, operation?: string): DAXCatalogError {
    let userMessage = 'Unable to connect to the AI analysis service. ';
    
    if (originalError.message.includes('rate limit')) {
      userMessage += 'The service is temporarily busy. Please try again in a few minutes.';
    } else if (originalError.message.includes('auth')) {
      userMessage += 'Authentication failed. Please check your API configuration.';
    } else {
      userMessage += 'Please check your internet connection and try again.';
    }

    const error = DAXCatalogError.createUserFriendly(
      ErrorCode.CLAUDE_API_ERROR,
      userMessage,
      `Claude API error: ${originalError.message}`,
      { operation: operation || 'claude_api_call' },
      originalError
    );
    (error as any).isRetryable = true;
    return error;
  }

  static claudeTimeout(operation?: string): DAXCatalogError {
    const error = DAXCatalogError.createUserFriendly(
      ErrorCode.CLAUDE_TIMEOUT,
      'The AI analysis service is taking longer than expected. Please try again.',
      'Claude API request timed out',
      { operation: operation || 'claude_api_call' }
    );
    (error as any).isRetryable = true;
    return error;
  }

  static claudeRateLimit(): DAXCatalogError {
    const error = DAXCatalogError.createUserFriendly(
      ErrorCode.CLAUDE_RATE_LIMIT,
      'The AI analysis service has reached its rate limit. Please wait a few minutes before trying again.',
      'Claude API rate limit exceeded',
      { operation: 'claude_api_call' }
    );
    (error as any).isRetryable = true;
    return error;
  }

  static claudeInvalidResponse(operation?: string): DAXCatalogError {
    const error = DAXCatalogError.createUserFriendly(
      ErrorCode.CLAUDE_INVALID_RESPONSE,
      'Received an unexpected response from the AI analysis service. Using fallback analysis instead.',
      'Claude API returned invalid response format',
      { operation: operation || 'claude_api_call' }
    );
    (error as any).isRetryable = true;
    return error;
  }

  // Documentation generation errors
  static docGenerationError(format: string, originalError: Error): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.DOC_GENERATION_ERROR,
      `Unable to generate ${format} documentation. Please try a different format or check the output location.`,
      `Documentation generation failed: ${originalError.message}`,
      { operation: 'doc_generation', additionalData: { format } },
      originalError
    );
  }

  // Configuration errors
  static missingApiKey(): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.MISSING_API_KEY,
      'AI analysis requires an Anthropic API key. Please set the ANTHROPIC_API_KEY environment variable.',
      'Missing Anthropic API key configuration',
      { operation: 'configuration' }
    );
  }

  static invalidConfig(configName: string, expectedType: string): DAXCatalogError {
    return DAXCatalogError.createUserFriendly(
      ErrorCode.INVALID_CONFIG,
      `Invalid configuration for "${configName}". Expected ${expectedType}.`,
      `Configuration validation failed for ${configName}`,
      { operation: 'configuration', additionalData: { configName, expectedType } }
    );
  }
}

/**
 * Global error handler for unhandled errors
 */
export class GlobalErrorHandler {
  private static instance: GlobalErrorHandler;

  private constructor() {
    this.setupGlobalHandlers();
  }

  static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler();
    }
    return GlobalErrorHandler.instance;
  }

  private setupGlobalHandlers(): void {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      this.handleUnhandledRejection(reason, promise);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.handleUncaughtException(error);
    });
  }

  private async handleUnhandledRejection(reason: unknown, _promise: Promise<unknown>): Promise<void> {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    
    await logger.error(
      'Unhandled promise rejection',
      {
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      },
      error
    );

    // In production, you might want to exit the process
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  private async handleUncaughtException(error: Error): Promise<void> {
    await logger.error(
      'Uncaught exception',
      {
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      },
      error
    );

    // Always exit on uncaught exception
    process.exit(1);
  }
}

/**
 * Utility function to wrap async operations with error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  fallback?: T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const daxError = error instanceof DAXCatalogError 
      ? error 
      : new DAXCatalogError(
          ErrorCode.UNKNOWN_ERROR,
          error instanceof Error ? error.message : String(error),
          context,
          error instanceof Error ? error : undefined
        );

    await logger.error(
      daxError.message,
      daxError.toJSON()
    );

    if (fallback !== undefined) {
      return fallback;
    }

    throw daxError;
  }
}

/**
 * Retry wrapper for retryable operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  maxAttempts = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const isRetryable = error instanceof DAXCatalogError 
        ? error.isRetryable 
        : true; // Assume unknown errors are retryable

      if (!isRetryable || attempt === maxAttempts) {
        break;
      }

      await logger.warn(
        `Operation failed, retrying (${attempt}/${maxAttempts})`,
        { attempt, maxAttempts, error: lastError.message }
      );

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
    }
  }

  throw lastError;
}

// Initialize global error handler
GlobalErrorHandler.getInstance();