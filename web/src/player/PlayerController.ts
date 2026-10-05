/**
 * PlayerController: Non-intrusive interface with Jellyfin's official video player,
 * providing clean access to playback rate, stream stats, video canvas frame capture,
 * media events, rich stream codec inspection, HDR/Dolby Vision flags, and real-time bitrate.
 */

export interface DetailedMediaInfo {
    videoCodec: string;
    videoProfile?: string;
    resolutionText: string;
    bitDepthText?: string;
    isHdr: boolean;
    hdrFlags: string[];
    doviTitle?: string;
    colorSpace?: string;
    audioCodec: string;
    audioProfile?: string;
    audioChannelsText: string;
    playbackMethod: 'Direct Play' | 'Direct Stream' | 'Transcode';
    transcodeReason?: string;
    hardwareAcceleration?: string;
    container?: string;
    nominalBitrateBps: number;
    realtimeBitrateBps: number;
    formattedRealtimeBitrate: string;
}

export class PlayerController {
    private static instance: PlayerController;
    private videoElement: HTMLVideoElement | null = null;
    private listeners: Map<string, Set<Function>> = new Map();

    // Real-time bitrate calculation tracking
    private lastResourceIndex: number = 0;
    private transferSamples: Array<{ timestamp: number; bytes: number }> = [];
    private lastCalculatedBitrateBps: number = 0;
    private bitrateTrackerInterval: any = null;

    private constructor() {
        this.bindEvents();
        this.startBitrateTracker();
    }

    public static getInstance(): PlayerController {
        if (!PlayerController.instance) {
            PlayerController.instance = new PlayerController();
        }
        return PlayerController.instance;
    }

    public getVideo(): HTMLVideoElement | null {
        if (this.videoElement && document.contains(this.videoElement)) {
            return this.videoElement;
        }

        const video = document.querySelector('video.htmlvideoplayer, video') as HTMLVideoElement;
        if (video) {
            this.videoElement = video;
            this.attachVideoListeners(video);
        }
        return this.videoElement;
    }

    public getPlaybackRate(): number {
        const v = this.getVideo();
        return v ? v.playbackRate : 1.0;
    }

    public setPlaybackRate(rate: number): void {
        const v = this.getVideo();
        if (v) {
            v.playbackRate = rate;
            this.emit('ratechange', rate);
        }
    }

    public getCurrentTime(): number {
        const v = this.getVideo();
        return v ? v.currentTime : 0;
    }

    public getDuration(): number {
        const v = this.getVideo();
        return v ? v.duration : 0;
    }

    public isPaused(): boolean {
        const v = this.getVideo();
        return v ? v.paused : true;
    }

    /**
     * Captures the current video frame cleanly as a lossless or compressed image without any OSD.
     */
    public async captureCurrentFrame(options: { format?: string; quality?: number } = {}): Promise<{
        blob: Blob;
        dataUrl: string;
        width: number;
        height: number;
    } | null> {
        const video = this.getVideo();
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
            return null;
        }

        const format = options.format || 'image/png';
        const quality = options.quality ?? 0.95;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    resolve(null);
                    return;
                }
                const dataUrl = canvas.toDataURL(format, quality);
                resolve({
                    blob,
                    dataUrl,
                    width: canvas.width,
                    height: canvas.height
                });
            }, format, quality);
        });
    }

    /**
     * Inspects active Jellyfin playbackManager to retrieve comprehensive stream codecs,
     * HDR / Dolby Vision flags, audio channels, playback method, and live bitrate.
     */
    public getDetailedMediaInfo(): DetailedMediaInfo {
        const video = this.getVideo();
        const pbManager = (window as any).playbackManager;
        const player = pbManager?.getCurrentPlayer ? pbManager.getCurrentPlayer() : null;
        const mediaSource = pbManager?.currentMediaSource ? pbManager.currentMediaSource(player) : null;

        // Video stream resolution
        const width = video?.videoWidth || 0;
        const height = video?.videoHeight || 0;
        let resolutionText = width > 0 ? `${width}x${height}` : 'HD';
        if (width >= 3800 || height >= 2100) {
            resolutionText = '4K UHD';
        } else if (width >= 2500 || height >= 1400) {
            resolutionText = '1440p QHD';
        } else if (width >= 1800 || height >= 1000) {
            resolutionText = '1080p FHD';
        } else if (width >= 1200 || height >= 700) {
            resolutionText = '720p HD';
        }

        const mediaStreams = mediaSource?.MediaStreams || [];
        const videoStream = mediaStreams.find((s: any) => s.Type === 'Video') || {};

        // 1. Video Codec
        let videoCodec = (videoStream.Codec || 'Auto').toUpperCase();
        if (videoCodec === 'H264') videoCodec = 'AVC / H.264';
        if (videoCodec === 'HEVC' || videoCodec === 'H265') videoCodec = 'HEVC / H.265';
        if (videoCodec === 'AV01') videoCodec = 'AV1';
        if (videoCodec === 'VP09') videoCodec = 'VP9';

        // Bit Depth
        const bitDepth = videoStream.BitDepth ? `${videoStream.BitDepth}-bit` : undefined;

        // 2. HDR & Special Video Flags
        const hdrFlags: string[] = [];
        let isHdr = false;
        let doviTitle: string | undefined = undefined;

        if (videoStream.VideoDoViTitle) {
            doviTitle = videoStream.VideoDoViTitle;
            hdrFlags.push('Dolby Vision');
            isHdr = true;
        } else if (videoStream.VideoRangeType === 'DOVI' || videoStream.VideoRangeType === 'DOVIWithHDR10') {
            doviTitle = 'Dolby Vision';
            hdrFlags.push('Dolby Vision');
            isHdr = true;
        }

        if (videoStream.VideoRangeType === 'HDR10Plus' || videoStream.VideoRange === 'HDR10+') {
            hdrFlags.push('HDR10+');
            isHdr = true;
        } else if (videoStream.VideoRangeType === 'HDR10' || videoStream.VideoRange === 'HDR') {
            if (!hdrFlags.includes('HDR10')) {
                hdrFlags.push('HDR10');
            }
            isHdr = true;
        } else if (videoStream.VideoRangeType === 'HLG') {
            hdrFlags.push('HLG');
            isHdr = true;
        }

        // Color Space
        let colorSpace: string | undefined = undefined;
        if (videoStream.ColorSpace) {
            const cs = videoStream.ColorSpace.toLowerCase();
            if (cs.includes('2020')) colorSpace = 'BT.2020';
            else if (cs.includes('709')) colorSpace = 'BT.709';
            else if (cs.includes('dci') || cs.includes('p3')) colorSpace = 'DCI-P3';
        }

        // 3. Audio Codec & Channels
        const audioStreamIndex = pbManager?.getAudioStreamIndex ? pbManager.getAudioStreamIndex(player) : -1;
        const audioTracks = pbManager?.audioTracks ? pbManager.audioTracks(player) : [];
        const audioStream = audioTracks.find((s: any) => s.Index === audioStreamIndex) ||
                            mediaStreams.find((s: any) => s.Type === 'Audio') || {};

        let rawAudioCodec = (audioStream.Codec || 'AAC').toUpperCase();
        let audioProfile = audioStream.Profile || undefined;
        let audioCodec = rawAudioCodec;

        if (rawAudioCodec === 'TRUEHD') {
            audioCodec = 'Dolby TrueHD';
            if (audioProfile?.toLowerCase().includes('atmos') || videoStream.Title?.includes('Atmos')) {
                audioProfile = 'Atmos';
            }
        } else if (rawAudioCodec === 'EAC3') {
            audioCodec = 'E-AC-3';
            if (audioProfile?.toLowerCase().includes('atmos') || audioStream.Title?.includes('Atmos')) {
                audioProfile = 'Atmos';
            }
        } else if (rawAudioCodec === 'DCA' || rawAudioCodec === 'DTS') {
            audioCodec = 'DTS';
            if (audioProfile?.includes('MA') || audioProfile?.includes('Master')) {
                audioCodec = 'DTS-HD MA';
            } else if (audioProfile?.includes('X')) {
                audioCodec = 'DTS:X';
            }
        }

        let audioChannelsText = 'Stereo';
        if (audioStream.Channels === 8) {
            audioChannelsText = '7.1';
        } else if (audioStream.Channels === 6) {
            audioChannelsText = '5.1';
        } else if (audioStream.Channels === 2) {
            audioChannelsText = '2.0';
        } else if (audioStream.Channels === 1) {
            audioChannelsText = 'Mono';
        }

        // 4. Playback Method & Transcoding Info
        let playbackMethod: 'Direct Play' | 'Direct Stream' | 'Transcode' = 'Direct Play';
        let transcodeReason: string | undefined = undefined;
        let hardwareAcceleration: string | undefined = undefined;

        const session = (window as any).playbackSession || (player as any)?._currentSession || null;
        const playMethodStr = pbManager?.getPlaybackMethod ? pbManager.getPlaybackMethod(player) : null;

        if (playMethodStr === 'Transcode' || session?.TranscodingInfo) {
            playbackMethod = 'Transcode';
            const tc = session?.TranscodingInfo;
            if (tc) {
                if (tc.TranscodeReasons && tc.TranscodeReasons.length) {
                    transcodeReason = tc.TranscodeReasons.join(', ');
                }
                if (tc.HardwareAccelerationType) {
                    hardwareAcceleration = tc.HardwareAccelerationType.toUpperCase();
                }
            }
        } else if (playMethodStr === 'DirectStream') {
            playbackMethod = 'Direct Stream';
        } else if (video?.src && video.src.includes('/master.m3u8')) {
            playbackMethod = 'Transcode';
        }

        // 5. Bitrate Metrics
        const nominalBitrateBps = mediaSource?.Bitrate || videoStream.BitRate || 0;
        const realtimeBitrateBps = this.lastCalculatedBitrateBps > 0
            ? this.lastCalculatedBitrateBps
            : nominalBitrateBps;

        return {
            videoCodec,
            videoProfile: videoStream.Profile,
            resolutionText,
            bitDepthText: bitDepth,
            isHdr,
            hdrFlags,
            doviTitle,
            colorSpace,
            audioCodec,
            audioProfile,
            audioChannelsText,
            playbackMethod,
            transcodeReason,
            hardwareAcceleration,
            container: (mediaSource?.Container || 'MKV').toUpperCase(),
            nominalBitrateBps,
            realtimeBitrateBps,
            formattedRealtimeBitrate: this.formatBitrate(realtimeBitrateBps)
        };
    }

    /**
     * Formats bitrate number in bits/sec into human-readable string.
     */
    public formatBitrate(bps: number, unit: 'Mbps' | 'MB/s' | 'Kbps' = 'Mbps'): string {
        if (!bps || isNaN(bps) || bps <= 0) return '0.0 Mbps';

        if (unit === 'MB/s') {
            const mBps = (bps / 8) / 1000000;
            return `${mBps.toFixed(2)} MB/s`;
        }

        if (unit === 'Kbps' || bps < 1000000) {
            return `${Math.round(bps / 1000)} Kbps`;
        }

        const mbps = bps / 1000000;
        return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
    }

    /**
     * Retrieves stream statistics and buffer health.
     */
    public getStreamStats(): {
        resolution: string;
        bufferHealthSeconds: number;
        droppedFrames: number;
        currentTimeFormatted: string;
        durationFormatted: string;
    } {
        const video = this.getVideo();
        if (!video) {
            return {
                resolution: 'N/A',
                bufferHealthSeconds: 0,
                droppedFrames: 0,
                currentTimeFormatted: '0:00',
                durationFormatted: '0:00'
            };
        }

        let bufferHealth = 0;
        const current = video.currentTime;
        for (let i = 0; i < video.buffered.length; i++) {
            const start = video.buffered.start(i);
            const end = video.buffered.end(i);
            if (current >= start && current <= end) {
                bufferHealth = Math.max(0, end - current);
                break;
            }
        }

        let dropped = 0;
        if ((video as any).getVideoPlaybackQuality) {
            const q = (video as any).getVideoPlaybackQuality();
            dropped = q.droppedVideoFrames || 0;
        } else if ((video as any).webkitDroppedFrameCount) {
            dropped = (video as any).webkitDroppedFrameCount || 0;
        }

        return {
            resolution: video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : 'Auto',
            bufferHealthSeconds: Math.round(bufferHealth * 10) / 10,
            droppedFrames: dropped,
            currentTimeFormatted: this.formatTime(current),
            durationFormatted: this.formatTime(video.duration || 0)
        };
    }

    public on(event: string, callback: Function): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);

        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }

    private emit(event: string, ...args: any[]): void {
        const set = this.listeners.get(event);
        if (set) {
            set.forEach(cb => {
                try {
                    cb(...args);
                } catch (e) {
                    console.error('[PlayAdapt] Error in player callback:', e);
                }
            });
        }
    }

    private bindEvents(): void {
        setInterval(() => {
            this.getVideo();
        }, 1000);
    }

    private attachVideoListeners(video: HTMLVideoElement): void {
        const events = ['play', 'pause', 'ratechange', 'timeupdate', 'volumechange', 'ended', 'seeking', 'seeked'];
        events.forEach(evt => {
            video.addEventListener(evt, () => {
                this.emit(evt, video);
            });
        });
    }

    /**
     * Real-time network throughput and bitrate calculation.
     */
    private startBitrateTracker(): void {
        if (this.bitrateTrackerInterval) return;

        this.bitrateTrackerInterval = setInterval(() => {
            const now = Date.now();

            // 1. Check HLS.js bandwidth estimate if present
            const player = (window as any).playbackManager?.getCurrentPlayer?.();
            const hls = (window as any).hls || player?.hls || player?._hls;
            if (hls && typeof hls.bandwidthEstimate === 'number' && hls.bandwidthEstimate > 0) {
                this.lastCalculatedBitrateBps = hls.bandwidthEstimate;
                return;
            }

            // 2. Measure network resource timing for video chunks/streams
            if (window.performance && performance.getEntriesByType) {
                const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
                for (let i = this.lastResourceIndex; i < entries.length; i++) {
                    const entry = entries[i];
                    if (entry.transferSize > 0 && (
                        entry.name.includes('/stream') ||
                        entry.name.includes('.m3u8') ||
                        entry.name.includes('.ts') ||
                        entry.name.includes('.m4s') ||
                        entry.name.includes('/Videos/')
                    )) {
                        this.transferSamples.push({ timestamp: now, bytes: entry.transferSize });
                    }
                }
                this.lastResourceIndex = entries.length;
            }

            // Keep samples within a 4-second sliding window
            this.transferSamples = this.transferSamples.filter(s => now - s.timestamp <= 4000);

            if (this.transferSamples.length > 0) {
                const totalBytes = this.transferSamples.reduce((acc, s) => acc + s.bytes, 0);
                const oldest = this.transferSamples[0].timestamp;
                const durationSec = Math.max(0.8, (now - oldest) / 1000);
                this.lastCalculatedBitrateBps = Math.round((totalBytes * 8) / durationSec);
            }
        }, 1000);
    }

    private formatTime(seconds: number): string {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
}
