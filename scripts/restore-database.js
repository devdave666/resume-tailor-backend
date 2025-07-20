#!/usr/bin/env node
/**
 * Database Restore Script
 * Restores database from backup files
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const readline = require('readline');
require('dotenv').config();

class DatabaseRestore {
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

    async listLocalBackups() {
        console.log('📁 Scanning local backups...');
        
        if (!fs.existsSync(this.backupDir)) {
            console.log('⚠️  No local backup directory found');
            return [];
        }

        const files = fs.readdirSync(this.backupDir)
            .filter(file => file.endsWith('.sql'))
            .map(file => {
                const filePath = path.join(this.backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime,
                    type: 'local'
                };
            })
            .sort((a, b) => b.modified - a.modified);

        console.log(`📋 Found ${files.length} local backup files`);
        return files;
    }

    async listS3Backups() {
        if (!this.s3Client || !this.s3Bucket) {
            console.log('⏭️  S3 backup listing skipped (not configured)');
            return [];
        }

        console.log('☁️  Scanning S3 backups...');

        try {
            const command = new ListObjectsV2Command({
                Bucket: this.s3Bucket,
                Prefix: 'database-backups/',
                MaxKeys: 100
            });

            const response = await this.s3Client.send(command);
            
            const backups = (response.Contents || [])
                .filter(obj => obj.Key.endsWith('.sql'))
                .map(obj => ({
                    name: path.basename(obj.Key),
                    key: obj.Key,
                    size: obj.Size,
                    modified: obj.LastModified,
                    type: 's3'
                }))
                .sort((a, b) => b.modified - a.modified);

            console.log(`📋 Found ${backups.length} S3 backup files`);
            return backups;
        } catch (error) {
            console.error('❌ Failed to list S3 backups:', error.message);
            return [];
        }
    }

    async downloadFromS3(s3Key, localPath) {
        console.log(`⬇️  Downloading backup from S3: ${s3Key}`);

        try {
            const command = new GetObjectCommand({
                Bucket: this.s3Bucket,
                Key: s3Key
            });

            const response = await this.s3Client.send(command);
            const writeStream = fs.createWriteStream(localPath);

            return new Promise((resolve, reject) => {
                response.Body.pipe(writeStream);
                
                writeStream.on('finish', () => {
                    console.log('✅ Download completed');
                    resolve(localPath);
                });
                
                writeStream.on('error', reject);
                response.Body.on('error', reject);
            });
        } catch (error) {
            console.error('❌ S3 download failed:', error.message);
            throw error;
        }
    }

    async selectBackup() {
        const localBackups = await this.listLocalBackups();
        const s3Backups = await this.listS3Backups();
        const allBackups = [...localBackups, ...s3Backups];

        if (allBackups.length === 0) {
            throw new Error('No backup files found');
        }

        console.log('\n📋 Available backups:');
        allBackups.forEach((backup, index) => {
            const sizeInMB = (backup.size / (1024 * 1024)).toFixed(2);
            const date = backup.modified.toLocaleString();
            const location = backup.type === 's3' ? '☁️  S3' : '💾 Local';
            console.log(`${index + 1}. ${backup.name} (${sizeInMB} MB, ${date}) ${location}`);
        });

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('\n🔢 Select backup number (or 0 to cancel): ', (answer) => {
                rl.close();
                
                const selection = parseInt(answer);
                if (selection === 0) {
                    console.log('❌ Restore cancelled');
                    process.exit(0);
                }
                
                if (selection < 1 || selection > allBackups.length) {
                    throw new Error('Invalid selection');
                }
                
                resolve(allBackups[selection - 1]);
            });
        });
    }

    async confirmRestore() {
        console.log('\n⚠️  WARNING: This will completely replace the current database!');
        console.log(`🎯 Target database: ${this.dbConfig.database}@${this.dbConfig.host}:${this.dbConfig.port}`);
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('\n❓ Are you sure you want to continue? (type "yes" to confirm): ', (answer) => {
                rl.close();
                
                if (answer.toLowerCase() !== 'yes') {
                    console.log('❌ Restore cancelled');
                    process.exit(0);
                }
                
                resolve(true);
            });
        });
    }

    async restoreFromFile(filePath) {
        console.log(`🔄 Restoring database from: ${filePath}`);

        return new Promise((resolve, reject) => {
            const pgRestoreArgs = [
                '-h', this.dbConfig.host,
                '-p', this.dbConfig.port.toString(),
                '-U', this.dbConfig.username,
                '-d', this.dbConfig.database,
                '--verbose',
                '--clean',
                '--no-owner',
                '--no-privileges',
                filePath
            ];

            console.log(`🔧 Running: pg_restore ${pgRestoreArgs.join(' ')}`);

            const pgRestore = spawn('pg_restore', pgRestoreArgs, {
                env: {
                    ...process.env,
                    PGPASSWORD: process.env.DB_PASSWORD
                }
            });

            let stderr = '';

            pgRestore.stdout.on('data', (data) => {
                console.log(`📝 ${data.toString().trim()}`);
            });

            pgRestore.stderr.on('data', (data) => {
                stderr += data.toString();
                console.log(`📝 ${data.toString().trim()}`);
            });

            pgRestore.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Database restore completed successfully');
                    resolve();
                } else {
                    console.error('❌ Database restore failed');
                    console.error(stderr);
                    reject(new Error(`pg_restore exited with code ${code}`));
                }
            });

            pgRestore.on('error', (error) => {
                console.error('❌ Failed to start pg_restore:', error.message);
                reject(error);
            });
        });
    }

    async run() {
        try {
            console.log('🚀 Starting database restore process...');
            
            // Select backup file
            const selectedBackup = await this.selectBackup();
            console.log(`\n✅ Selected: ${selectedBackup.name}`);
            
            // Confirm restore
            await this.confirmRestore();
            
            // Download from S3 if needed
            let restoreFilePath = selectedBackup.path;
            if (selectedBackup.type === 's3') {
                const tempPath = path.join(this.backupDir, selectedBackup.name);
                
                // Ensure backup directory exists
                if (!fs.existsSync(this.backupDir)) {
                    fs.mkdirSync(this.backupDir, { recursive: true });
                }
                
                await this.downloadFromS3(selectedBackup.key, tempPath);
                restoreFilePath = tempPath;
            }
            
            // Restore database
            await this.restoreFromFile(restoreFilePath);
            
            // Clean up downloaded file if it was from S3
            if (selectedBackup.type === 's3') {
                fs.unlinkSync(restoreFilePath);
                console.log('🧹 Cleaned up temporary file');
            }
            
            console.log('🎉 Database restore completed successfully!');
            
        } catch (error) {
            console.error('💥 Database restore failed:', error.message);
            throw error;
        }
    }
}

// Run if called directly
if (require.main === module) {
    const restore = new DatabaseRestore();
    restore.run()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = DatabaseRestore;