#!/usr/bin/env node
/**
 * Database Backup Script
 * Creates automated backups of the production database
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

class DatabaseBackup {
    constructor() {
        this.backupDir = process.env.BACKUP_DIR || './backups';
        this.s3Bucket = process.env.BACKUP_S3_BUCKET;
        this.s3Client = this.s3Bucket ? new S3Client({ region: process.env.AWS_REGION || 'us-east-1' }) : null;
        
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'resume_tailor',
            username: process.env.DB_USER || 'postgres'
        };
    }

    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `${this.dbConfig.database}_backup_${timestamp}.sql`;
        const backupPath = path.join(this.backupDir, backupFileName);

        console.log('🗄️  Starting database backup...');
        console.log(`📁 Backup file: ${backupPath}`);

        // Ensure backup directory exists
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            const pgDumpArgs = [
                '-h', this.dbConfig.host,
                '-p', this.dbConfig.port.toString(),
                '-U', this.dbConfig.username,
                '-d', this.dbConfig.database,
                '--verbose',
                '--clean',
                '--no-owner',
                '--no-privileges',
                '--format=custom',
                '--file', backupPath
            ];

            console.log(`🔧 Running: pg_dump ${pgDumpArgs.join(' ')}`);

            const pgDump = spawn('pg_dump', pgDumpArgs, {
                env: {
                    ...process.env,
                    PGPASSWORD: process.env.DB_PASSWORD
                }
            });

            let stderr = '';

            pgDump.stderr.on('data', (data) => {
                stderr += data.toString();
                console.log(`📝 ${data.toString().trim()}`);
            });

            pgDump.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Database backup completed successfully');
                    
                    // Get file size
                    const stats = fs.statSync(backupPath);
                    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
                    console.log(`📊 Backup size: ${fileSizeInMB} MB`);
                    
                    resolve({
                        fileName: backupFileName,
                        filePath: backupPath,
                        size: stats.size,
                        timestamp: new Date()
                    });
                } else {
                    console.error('❌ Database backup failed');
                    console.error(stderr);
                    reject(new Error(`pg_dump exited with code ${code}`));
                }
            });

            pgDump.on('error', (error) => {
                console.error('❌ Failed to start pg_dump:', error.message);
                reject(error);
            });
        });
    }

    async uploadToS3(backupInfo) {
        if (!this.s3Client || !this.s3Bucket) {
            console.log('⏭️  S3 upload skipped (not configured)');
            return null;
        }

        console.log('☁️  Uploading backup to S3...');

        try {
            const fileStream = fs.createReadStream(backupInfo.filePath);
            const s3Key = `database-backups/${backupInfo.fileName}`;

            const uploadParams = {
                Bucket: this.s3Bucket,
                Key: s3Key,
                Body: fileStream,
                ContentType: 'application/octet-stream',
                Metadata: {
                    'backup-timestamp': backupInfo.timestamp.toISOString(),
                    'database-name': this.dbConfig.database,
                    'backup-size': backupInfo.size.toString()
                }
            };

            const result = await this.s3Client.send(new PutObjectCommand(uploadParams));
            
            console.log('✅ Backup uploaded to S3 successfully');
            console.log(`🔗 S3 Key: ${s3Key}`);
            
            return {
                bucket: this.s3Bucket,
                key: s3Key,
                etag: result.ETag
            };
        } catch (error) {
            console.error('❌ S3 upload failed:', error.message);
            throw error;
        }
    }

    async cleanupOldBackups(retentionDays = 7) {
        console.log(`🧹 Cleaning up backups older than ${retentionDays} days...`);

        try {
            const files = fs.readdirSync(this.backupDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            let deletedCount = 0;

            for (const file of files) {
                if (!file.endsWith('.sql')) continue;

                const filePath = path.join(this.backupDir, file);
                const stats = fs.statSync(filePath);

                if (stats.mtime < cutoffDate) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️  Deleted old backup: ${file}`);
                    deletedCount++;
                }
            }

            console.log(`✅ Cleanup completed. Deleted ${deletedCount} old backups`);
        } catch (error) {
            console.error('❌ Cleanup failed:', error.message);
        }
    }

    async run() {
        try {
            console.log('🚀 Starting automated database backup...');
            console.log(`🎯 Database: ${this.dbConfig.database}@${this.dbConfig.host}:${this.dbConfig.port}`);
            
            // Create backup
            const backupInfo = await this.createBackup();
            
            // Upload to S3 if configured
            const s3Info = await this.uploadToS3(backupInfo);
            
            // Cleanup old backups
            await this.cleanupOldBackups();
            
            console.log('🎉 Backup process completed successfully!');
            
            return {
                backup: backupInfo,
                s3: s3Info,
                success: true
            };
            
        } catch (error) {
            console.error('💥 Backup process failed:', error.message);
            throw error;
        }
    }
}

// Run if called directly
if (require.main === module) {
    const backup = new DatabaseBackup();
    backup.run()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = DatabaseBackup;