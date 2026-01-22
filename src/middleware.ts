import { Request, Response, NextFunction, RequestHandler } from 'express';
import zlib from 'zlib';
import isCompressible from 'compressible';
import onHeaders from 'on-headers';
import vary from 'vary';

interface CompressionOptions {
  threshold?: number | string;
  filter?: (req: Request, res: Response) => boolean;
  zstd?: zlib.ZstdOptions;
  br?: zlib.BrotliOptions;
  gzip?: zlib.ZlibOptions;
  deflate?: zlib.ZlibOptions;
}

declare module 'express' {
    interface Response {
        flush?: () => void;
    }
}

export function modernCompression(options: CompressionOptions = {}): RequestHandler {
  const {
    threshold = 1024,
    filter = (req: Request, res: Response) => {
      const type = res.getHeader('Content-Type');
      return typeof type === 'string' && isCompressible(type);
    },
  } = options;

  const byteThreshold = typeof threshold === 'string' ? parseInt(threshold, 10) : threshold;

  return (req: Request, res: Response, next: NextFunction) => {
    let compressor: zlib.ZstdCompress | zlib.BrotliCompress | zlib.Deflate | zlib.Gzip;
    let started = false;
    let ended = false;

    const originalWrite = res.write;
    const originalEnd = res.end;

    // 1. 协商算法
    const acceptEncoding = req.headers['accept-encoding'] as string || '';
    let method: 'zstd' | 'br' | 'gzip' | 'deflate' | undefined;

    if (acceptEncoding.includes('zstd')) method = 'zstd';
    else if (acceptEncoding.includes('br')) method = 'br';
    else if (acceptEncoding.includes('gzip')) method = 'gzip';
    else if (acceptEncoding.includes('deflate')) method = 'deflate';

    onHeaders(res, () => {
      if (!method || !filter(req, res) || res.getHeader('Content-Encoding')) {
        method = undefined; // 放弃压缩
        return;
      }
      vary(res, 'Accept-Encoding');
      res.setHeader('Content-Encoding', method);
      res.removeHeader('Content-Length');
    });

    // 核心启动函数
    const startCompression = (chunk: any) => {
      started = true;

      switch (method) {
        case 'zstd':
          compressor = zlib.createZstdCompress(options.zstd);
          break;
        case 'br':
          compressor = zlib.createBrotliCompress(options.br);
          break;
        case 'gzip':
          compressor = zlib.createGzip(options.gzip);
          break;
        case 'deflate':
          compressor = zlib.createDeflate(options.deflate);
          break;
        default:
          throw new Error('Unsupported compression method');
      }

      // 监听压缩后的数据
      compressor.on('data', (chunk: Buffer) => {
        // 使用你提到的 binary 编码，确保字节流不被破坏
        if (originalWrite.call(res, chunk, 'binary') === false) {
          compressor.pause();
        }
      });

      // 处理背压：当底层的 socket 缓冲区清空时，恢复压缩器
      res.on('drain', () => {
        compressor?.resume();
      });

      compressor.on('end', () => {
        originalEnd.apply(res);
      });
    };

    // 重写 res.write
    res.write = function (chunk: any, encoding?: any, callback?: any): boolean {
      if (ended) return false;
      if (!method) return originalWrite.call(res, chunk, encoding, callback);

      if (!started) {
        if (getLen(chunk, encoding) < byteThreshold) {
          return originalWrite.call(res, chunk, encoding, callback);
        }
        startCompression(chunk);
      }

      return compressor.write(chunk, encoding, callback);
    };

    // 重写 res.end
    res.end = function (chunk?: any, encoding?: any, callback?: any): Response {
      if (ended) return res;
      ended = true;

      if (!method) return originalEnd.call(res, chunk, encoding, callback);

      if (!started) {
        if (chunk && getLen(chunk, encoding) >= byteThreshold) {
          startCompression(chunk);
        } else {
          // 如果到结束都没达到阈值，直接透传
          return originalEnd.call(res, chunk, encoding, callback);
        }
      }

      if (chunk) {
        compressor.write(chunk, encoding);
      }
      
      compressor.end(callback);
      return res;
    };

    res.flush = function (): void {
        if (compressor && typeof compressor.flush === 'function') {
            compressor.flush();
        }
    };

    next();
  };
}

function getLen(chunk: any, encoding?: string): number {
  if (!chunk) return 0;
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding as any);
}
