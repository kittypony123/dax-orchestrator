import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { getLogger } from './logger';

export interface FileSet {
  measures?: string;
  tables?: string;
  columns?: string;
  relationships?: string;
}

export interface FileDiscoveryResult {
  found: FileSet;
  missing: string[];
  directory: string;
}

export class FileManager {
  private logger = getLogger('FileManager');
  
  /**
   * Discover CSV files in a directory with flexible naming patterns
   */
  async discoverFiles(directory: string): Promise<FileDiscoveryResult> {
    try {
      await fs.access(directory);
    } catch {
      throw new Error(`Directory does not exist: ${directory}`);
    }

    const patterns = {
      measures: [
        'measures*.csv',
        '*measures*.csv', 
        'info*measures*.csv',
        'view*measures*.csv'
      ],
      tables: [
        'tables*.csv',
        '*tables*.csv',
        'info*tables*.csv', 
        'view*tables*.csv'
      ],
      columns: [
        'columns*.csv',
        '*columns*.csv',
        'info*columns*.csv',
        'view*columns*.csv'
      ],
      relationships: [
        'relationships*.csv',
        '*relationships*.csv', 
        'info*relationships*.csv',
        'view*relationships*.csv',
        'relation*.csv'
      ]
    };

    const found: FileSet = {};
    const missing: string[] = [];

    for (const [type, typePatterns] of Object.entries(patterns)) {
      let foundFile = null;
      
      for (const pattern of typePatterns) {
        const matches = await glob(pattern, { 
          cwd: directory,
          nocase: true,
          absolute: true 
        });
        
        if (matches.length > 0) {
          foundFile = matches[0]; // Take first match
          break;
        }
      }

      if (foundFile) {
        (found as any)[type] = foundFile;
      } else {
        missing.push(type);
      }
    }

    return {
      found,
      missing,
      directory
    };
  }

  /**
   * Validate that a file exists and is readable
   */
  async validateFile(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, fs.constants.R_OK);
      await this.logger.debug(`File validation successful: ${filePath}`);
      return true;
    } catch (error) {
      await this.logger.warn(`File validation failed: ${filePath}`, { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Get file stats and basic info
   */
  async getFileInfo(filePath: string): Promise<{ size: number; modified: Date; exists: boolean }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        modified: stats.mtime,
        exists: true
      };
    } catch {
      return {
        size: 0,
        modified: new Date(0),
        exists: false
      };
    }
  }

  /**
   * Ensure output directory exists
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      await this.logger.debug(`Created directory: ${dirPath}`);
    }
  }

  /**
   * Generate safe output filename with timestamp
   */
  generateOutputPath(baseDir: string, filename: string, extension: string = 'md'): string {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const safeName = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(baseDir, `${safeName}_${timestamp}.${extension}`);
  }

  /**
   * Read and preview CSV file structure
   */
  async previewCSV(filePath: string, maxRows: number = 5): Promise<{ headers: string[]; preview: any[]; totalRows: number }> {
    return new Promise((resolve, reject) => {
      const rows: any[] = [];
      let headers: string[] = [];
      let totalRows = 0;

      fsSync.createReadStream(filePath)
        .pipe(require('csv-parser')())
        .on('headers', (headerList: string[]) => {
          headers = headerList;
        })
        .on('data', (row: any) => {
          totalRows++;
          if (rows.length < maxRows) {
            rows.push(row);
          }
        })
        .on('end', () => {
          resolve({
            headers,
            preview: rows,
            totalRows
          });
        })
        .on('error', reject);
    });
  }

  /**
   * Create output directory structure
   */
  async setupOutputDirectories(baseDir: string): Promise<{ 
    reports: string; 
    catalogs: string; 
    imports: string; 
    summaries: string 
  }> {
    const dirs = {
      reports: path.join(baseDir, 'reports'),
      catalogs: path.join(baseDir, 'catalogs'), 
      imports: path.join(baseDir, 'imports'),
      summaries: path.join(baseDir, 'summaries')
    };

    // Create all directories concurrently
    await Promise.all(
      Object.values(dirs).map(dir => this.ensureDirectory(dir))
    );
    
    return dirs;
  }
}