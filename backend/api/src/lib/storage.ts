import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadConfig } from './config.js';

/**
 * Object storage adapter. MinIO in development, Cloudflare R2 in production —
 * both speak the S3 API, so only the endpoint differs (§22.1).
 *
 * The bucket is private. Clients never receive credentials; they get a
 * short-lived pre-signed URL and PUT ciphertext straight to storage, so the
 * backend never handles the bytes at all (§17.3).
 */

export interface StoredObjectRef {
  objectId: string;
  objectKey: string;
  bucket: string;
}

export class ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config = loadConfig()) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Opaque, unguessable key. Contains no user id, email or wallet address, so
   * a bucket listing reveals nothing about who owns what (§16.3).
   */
  newObjectKey(): StoredObjectRef {
    const objectId = randomUUID();
    return {
      objectId,
      objectKey: `private/objects/${objectId}/payload.bin`,
      bucket: this.config.S3_BUCKET,
    };
  }

  async createUploadUrl(objectKey: string, byteSize: number): Promise<{ url: string; expiresAt: Date }> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: objectKey,
        ContentLength: byteSize,
        ContentType: 'application/octet-stream',
      }),
      { expiresIn: this.config.UPLOAD_URL_TTL_SECONDS },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + this.config.UPLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  async createDownloadUrl(objectKey: string): Promise<{ url: string; expiresAt: Date }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
      { expiresIn: this.config.DOWNLOAD_URL_TTL_SECONDS },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + this.config.DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  /**
   * Confirms the client actually uploaded, and that the size matches what it
   * declared in the intent. A mismatch means the intent was reused or the
   * upload was truncated — either way the metadata must not be registered.
   */
  async verifyUpload(objectKey: string, expectedSize: number): Promise<boolean> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
      );
      return head.ContentLength === expectedSize;
    } catch {
      return false;
    }
  }

  /** Returns true only when storage confirmed removal (§12.4 cloud delete). */
  async deleteObject(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

let cached: ObjectStorage | undefined;

export function getStorage(): ObjectStorage {
  cached ??= new ObjectStorage();
  return cached;
}
