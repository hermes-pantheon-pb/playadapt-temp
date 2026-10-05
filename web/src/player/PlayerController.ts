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

    // Cached active playback state from Events bus or direct API queries
    private activePlayer: any = null;
    private activePlaybackManager: any = null;
    private activeMediaSource: any = null;
    private activeNowPlayingItem: any = null;
    private activeSession: any = null;
    private lastSessionFetchTime: number = 0;

    // Real-time bitrate calculation tracking
    private lastResourceIndex: number = 0;
    private transferSamples: Array<{ timestamp: number; bytes: number }> = [];
    private lastCalculatedBitrateBps: number = 0;
    private bitrateTrackerInterval: any = null;
    private lastBufferedTime: number = 0;
    private lastBufferCheckTime: number = 0;

    private constructor() {
        this.hookGlobalEvents();
        this.bindNetworkInterceptors();
        this.bindEvents();
        this.startBitrateTracker();
    }

    public static getInstance(): PlayerController {
        if (!PlayerController.instance) {
            PlayerController.instance = new PlayerController();
        }
        return PlayerController.instance;
    }

    /**
     * Intercepts Jellyfin's internal Events trigger bus so we capture playbackManager,
     * the active player instance, nowPlayingItem, and mediaSource directly as they fire.
     */
    private hookGlobalEvents(): void {
        const attachHook = () => {
            const events = (window as any).Events;
            if (!events || events._playAdaptHooked) return;
            events._playAdaptHooked = true;

            const originalTrigger = events.trigger;
            const self = this;
            events.trigger = function (obj: any, type: string, args: any[] = []) {
                try {
                    self.handleJellyfinEvent(obj, type, args);
                } catch (e) {
                    console.debug('[PlayAdapt] Event hook handler error:', e);
                }
                return originalTrigger.apply(this, arguments);
            };
        };

        attachHook();
        // Also periodically check in case Events is loaded after script initialization
        const checkTimer = setInterval(() => {
            if ((window as any).Events && (window as any).Events._playAdaptHooked) {
                clearInterval(checkTimer);
            } else if ((window as any).Events) {
                attachHook();
            }
        }, 1000);
    }

    private handleJellyfinEvent(obj: any, type: string, args: any[]): void {
        if (type === 'playbackstart') {
            // Events.trigger(player, 'playbackstart', [state])
            // OR Events.trigger(playbackManager, 'playbackstart', [player, state])
            let player = null;
            let state = null;
            if (args.length >= 2 && args[0] && args[1]) {
                player = args[0];
                state = args[1];
                this.activePlaybackManager = obj;
            } else if (args.length >= 1 && args[0]) {
                state = args[0];
                player = obj;
            }

            if (player) this.activePlayer = player;
            if (state) {
                if (state.MediaSource) this.activeMediaSource = state.MediaSource;
                if (state.NowPlayingItem) this.activeNowPlayingItem = state.NowPlayingItem;
            }

            // Expose playbackManager globally for ease of access if discovered
            if (this.activePlaybackManager && !(window as any).playbackManager) {
                (window as any).playbackManager = this.activePlaybackManager;
            }

            this.fetchActiveSession();
            this.emit('playbackstart', state);
        } else if (type === 'playerchange') {
            // Events.trigger(playbackManagerInstance, 'playerchange', [newPlayer, newTarget, previousPlayer]);
            this.activePlaybackManager = obj;
            if (args[0]) this.activePlayer = args[0];
            if (this.activePlaybackManager && !(window as any).playbackManager) {
                (window as any).playbackManager = this.activePlaybackManager;
            }
        } else if (type === 'mediastreamschange') {
            if (obj && obj.currentMediaSource) {
                this.activeMediaSource = obj.currentMediaSource();
            }
            this.fetchActiveSession();
        } else if (type === 'playbackstop') {
            this.activeSession = null;
            this.activeMediaSource = null;
            this.activeNowPlayingItem = null;
            this.emit('playbackstop');
        }
    }

    /**
     * Intercepts Fetch & XHR network requests for video chunks / HLS segments
     * to compute accurate real-time network throughput even when Timing-Allow-Origin is absent.
     */
    private bindNetworkInterceptors(): void {
        const self = this;

        // 1. Hook window.fetch
        if (typeof window.fetch === 'function') {
            const originalFetch = window.fetch;
            window.fetch = async function (...args: any[]) {
                const response = await originalFetch.apply(this, args as [RequestInfo | URL, RequestInit?]);
                try {
                    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                    if (self.isMediaUrl(url)) {
                        const clone = response.clone();
                        clone.arrayBuffer().then((buffer) => {
                            if (buffer && buffer.byteLength > 0) {
                                self.recordTransferBytes(buffer.byteLength);
                            }
                        }).catch(() => {});
                    }
                } catch (e) {
                    // Ignore inspection errors
                }
                return response;
            };
        }

        // 2. Hook XMLHttpRequest
        if (typeof XMLHttpRequest !== 'undefined') {
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function (this: any, _method: string, url: string | URL) {
                this._playAdaptUrl = typeof url === 'string' ? url : url.toString();
                return origOpen.apply(this, arguments as any);
            };

            XMLHttpRequest.prototype.send = function (this: any) {
                if (this._playAdaptUrl && self.isMediaUrl(this._playAdaptUrl)) {
                    this.addEventListener('progress', (e: ProgressEvent) => {
                        if (e.loaded > 0) {
                            const lastLoaded = this._playAdaptLastLoaded || 0;
                            const delta = e.loaded - lastLoaded;
                            if (delta > 0) {
                                self.recordTransferBytes(delta);
                                this._playAdaptLastLoaded = e.loaded;
                            }
                        }
                    });
                }
                return origSend.apply(this, arguments as any);
            };
        }
    }

    private isMediaUrl(url: string): boolean {
        if (!url) return false;
        return (
            url.includes('/stream') ||
            url.includes('/Videos/') ||
            url.includes('.m3u8') ||
            url.includes('.ts') ||
            url.includes('.m4s') ||
            url.includes('.mp4') ||
            url.includes('.webm') ||
            url.includes('/Audio/') ||
            url.includes('hls1/')
        );
    }

    private recordTransferBytes(bytes: number): void {
        const now = Date.now();
        this.transferSamples.push({ timestamp: now, bytes });
    }

    public getVideo(): HTMLVideoElement | null {
        if (this.videoElement && document.contains(this.videoElement)) {
            return this.videoElement;
        }

        const video = document.querySelector('video.htmlvideoplayer, video') as HTMLVideoElement;
        if (video) {
            this.videoElement = video;
            // Ensure crossOrigin is set for lossless canvas reads if allowed by server
            if (!video.crossOrigin) {
                try {
                    video.crossOrigin = 'anonymous';
                } catch (e) {
                    // Ignore
                }
            }
            this.attachVideoListeners(video);
        }
        return this.videoElement;
    }

    public getPlaybackRate(): number {
        const pbManager = this.getPlaybackManager();
        if (pbManager?.getPlaybackRate) {
            const r = pbManager.getPlaybackRate(this.activePlayer);
            if (typeof r === 'number' && !isNaN(r)) return r;
        }
        const v = this.getVideo();
        return v ? v.playbackRate : 1.0;
    }

    public setPlaybackRate(rate: number): void {
        const pbManager = this.getPlaybackManager();
        if (pbManager?.setPlaybackRate) {
            pbManager.setPlaybackRate(rate, this.activePlayer);
        }
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
     * Resolves the active PlaybackManager instance through multiple discovery paths.
     */
    private getPlaybackManager(): any {
        if (this.activePlaybackManager) return this.activePlaybackManager;
        if ((window as any).playbackManager) {
            this.activePlaybackManager = (window as any).playbackManager;
            return this.activePlaybackManager;
        }
        return null;
    }

    /**
     * Asynchronously queries the active session from Jellyfin ApiClient.
     */
    public async fetchActiveSession(): Promise<any> {
        const now = Date.now();
        if (this.activeSession && (now - this.lastSessionFetchTime < 6000)) {
            return this.activeSession;
        }

        try {
            const apiClient = (window as any).ApiClient;
            if (apiClient && typeof apiClient.getSessions === 'function') {
                const deviceId = typeof apiClient.deviceId === 'function' ? apiClient.deviceId() : undefined;
                const sessions = await apiClient.getSessions({ deviceId });
                if (sessions && sessions.length > 0) {
                    this.activeSession = sessions[0];
                    this.lastSessionFetchTime = now;
                    return this.activeSession;
                }
            }
        } catch (e) {
            console.debug('[PlayAdapt] Session fetch error:', e);
        }
        return this.activeSession;
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

        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob((blob) => {
                    if (!blob) {
                        resolve(null);
                        return;
                    }
                    try {
                        const dataUrl = canvas.toDataURL(format, quality);
                        resolve({
                            blob,
                            dataUrl,
                            width: canvas.width,
                            height: canvas.height
                        });
                    } catch (err) {
                        reject(err);
                    }
                }, format, quality);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Inspects active playback state, media sources, and sessions to retrieve comprehensive
     * stream codecs (OPUS, FLAC, AAC, AV1, HEVC), HDR/Dolby Vision flags, and real-time bitrate.
     */
    public getDetailedMediaInfo(): DetailedMediaInfo {
        const video = this.getVideo();
        const pbManager = this.getPlaybackManager();
        const player = this.activePlayer || (pbManager?.getCurrentPlayer ? pbManager.getCurrentPlayer() : null);

        // 1. Resolve MediaSource
        let mediaSource = this.activeMediaSource;
        if (!mediaSource && pbManager?.currentMediaSource) {
            try {
                mediaSource = pbManager.currentMediaSource(player);
            } catch (e) {
                // Ignore
            }
        }
        if (!mediaSource && player?._currentPlayOptions?.mediaSource) {
            mediaSource = player._currentPlayOptions.mediaSource;
        }

        // 2. Resolve NowPlayingItem
        let nowPlayingItem = this.activeNowPlayingItem;
        if (!nowPlayingItem && pbManager?.currentItem) {
            try {
                nowPlayingItem = pbManager.currentItem(player);
            } catch (e) {
                // Ignore
            }
        }
        if (!nowPlayingItem && player?._currentPlayOptions?.item) {
            nowPlayingItem = player._currentPlayOptions.item;
        }

        // 3. Resolve Session & Transcoding info
        const session = this.activeSession;
        const transcodeInfo = session?.TranscodingInfo;

        // Video stream resolution text
        const width = video?.videoWidth || 0;
        const height = video?.videoHeight || 0;
        let resolutionText = '';
        if (width >= 3800 || height >= 2100) {
            resolutionText = '4K UHD';
        } else if (width >= 2500 || height >= 1400) {
            resolutionText = '1440p QHD';
        } else if (width >= 1800 || height >= 1000) {
            resolutionText = '1080p FHD';
        } else if (width >= 1200 || height >= 700) {
            resolutionText = '720p HD';
        } else if (width > 0 && height > 0) {
            resolutionText = `${width}x${height}`;
        } else if (mediaSource?.MediaStreams) {
            const vStream = mediaSource.MediaStreams.find((s: any) => s.Type === 'Video');
            if (vStream?.Width && vStream?.Height) {
                if (vStream.Width >= 3800 || vStream.Height >= 2100) resolutionText = '4K UHD';
                else if (vStream.Width >= 1800 || vStream.Height >= 1000) resolutionText = '1080p FHD';
                else if (vStream.Width >= 1200 || vStream.Height >= 700) resolutionText = '720p HD';
                else resolutionText = `${vStream.Width}x${vStream.Height}`;
            }
        }

        const mediaStreams = mediaSource?.MediaStreams || nowPlayingItem?.MediaStreams || [];
        const videoStream = mediaStreams.find((s: any) => s.Type === 'Video') || {};

        // 4. Video Codec
        let rawVideoCodec = transcodeInfo?.VideoCodec || videoStream.Codec;
        let videoCodec = '';
        if (rawVideoCodec) {
            const upper = rawVideoCodec.toUpperCase();
            if (upper === 'H264' || upper === 'AVC') videoCodec = 'AVC / H.264';
            else if (upper === 'HEVC' || upper === 'H265') videoCodec = 'HEVC / H.265';
            else if (upper === 'AV01' || upper === 'AV1') videoCodec = 'AV1';
            else if (upper === 'VP09' || upper === 'VP9') videoCodec = 'VP9';
            else if (upper === 'VP8') videoCodec = 'VP8';
            else videoCodec = upper;
        } else if (video && video.videoWidth > 0) {
            videoCodec = 'Video';
        } else {
            videoCodec = 'Stream';
        }

        // Bit Depth
        const bitDepth = videoStream.BitDepth ? `${videoStream.BitDepth}-bit` : undefined;

        // 5. HDR & Special Video Flags
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

        // 6. Audio Codec & Channels
        const audioStreamIndex = pbManager?.getAudioStreamIndex ? pbManager.getAudioStreamIndex(player) : -1;
        const audioTracks = pbManager?.audioTracks ? pbManager.audioTracks(player) : [];
        const audioStream = audioTracks.find((s: any) => s.Index === audioStreamIndex) ||
                            mediaStreams.find((s: any) => s.Type === 'Audio') || {};

        let rawAudioCodec = transcodeInfo?.AudioCodec || audioStream.Codec || '';
        let audioProfile = audioStream.Profile || undefined;
        let audioCodec = '';

        if (rawAudioCodec) {
            const upper = rawAudioCodec.toUpperCase();
            if (upper === 'OPUS') {
                audioCodec = 'OPUS';
            } else if (upper === 'FLAC') {
                audioCodec = 'FLAC';
            } else if (upper === 'TRUEHD') {
                audioCodec = 'Dolby TrueHD';
                if (audioProfile?.toLowerCase().includes('atmos') || videoStream.Title?.includes('Atmos')) {
                    audioProfile = 'Atmos';
                }
            } else if (upper === 'EAC3') {
                audioCodec = 'E-AC-3';
                if (audioProfile?.toLowerCase().includes('atmos') || audioStream.Title?.includes('Atmos')) {
                    audioProfile = 'Atmos';
                }
            } else if (upper === 'AC3') {
                audioCodec = 'AC-3';
            } else if (upper === 'DCA' || upper === 'DTS') {
                audioCodec = 'DTS';
                if (audioProfile?.includes('MA') || audioProfile?.includes('Master')) {
                    audioCodec = 'DTS-HD MA';
                } else if (audioProfile?.includes('X')) {
                    audioCodec = 'DTS:X';
                }
            } else if (upper === 'VORBIS') {
                audioCodec = 'Vorbis';
            } else if (upper === 'MP3') {
                audioCodec = 'MP3';
            } else if (upper === 'AAC') {
                audioCodec = 'AAC';
            } else {
                audioCodec = upper;
            }
        }

        let audioChannelsText = '';
        const channels = transcodeInfo?.AudioChannels || audioStream.Channels;
        if (channels === 8) {
            audioChannelsText = '7.1';
        } else if (channels === 6) {
            audioChannelsText = '5.1';
        } else if (channels === 2) {
            audioChannelsText = '2.0';
        } else if (channels === 1) {
            audioChannelsText = 'Mono';
        } else if (audioStream.ChannelLayout) {
            audioChannelsText = audioStream.ChannelLayout;
        }

        // 7. Playback Method & Transcoding Info
        let playbackMethod: 'Direct Play' | 'Direct Stream' | 'Transcode' = 'Direct Play';
        let transcodeReason: string | undefined = undefined;
        let hardwareAcceleration: string | undefined = undefined;

        const playMethodStr = pbManager?.getPlaybackMethod ? pbManager.getPlaybackMethod(player) : null;
        if (playMethodStr === 'Transcode' || transcodeInfo) {
            playbackMethod = 'Transcode';
            if (transcodeInfo) {
                if (transcodeInfo.TranscodeReasons && transcodeInfo.TranscodeReasons.length) {
                    transcodeReason = transcodeInfo.TranscodeReasons.join(', ');
                }
                if (transcodeInfo.HardwareAccelerationType) {
                    hardwareAcceleration = transcodeInfo.HardwareAccelerationType.toUpperCase();
                }
            }
        } else if (playMethodStr === 'DirectStream' || (video?.src && video.src.includes('Static=true'))) {
            playbackMethod = 'Direct Stream';
        } else if (video?.src && video.src.includes('/master.m3u8')) {
            playbackMethod = 'Transcode';
        }

        // 8. Bitrate Metrics
        const nominalBitrateBps = transcodeInfo?.Bitrate || mediaSource?.Bitrate || videoStream.BitRate || 0;
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
     * Real-time network throughput and bitrate calculation:
     * Combines:
     * 1. HLS.js bandwidth estimates
     * 2. Intercepted fetch / XHR media segment chunk arrivals
     * 3. PerformanceResourceTiming transferSize deltas
     * 4. Media buffer advancement progression multiplied by nominal stream bitrate
     */
    private startBitrateTracker(): void {
        if (this.bitrateTrackerInterval) return;

        this.bitrateTrackerInterval = setInterval(() => {
            const now = Date.now();
            const player = this.activePlayer || (window as any).playbackManager?.getCurrentPlayer?.();

            // 1. Check HLS.js bandwidth estimate if present
            const hls = (window as any).hls || player?.hls || player?._hls || player?._hlsPlayer;
            if (hls && typeof hls.bandwidthEstimate === 'number' && hls.bandwidthEstimate > 0) {
                this.lastCalculatedBitrateBps = Math.round(hls.bandwidthEstimate);
                return;
            }

            // 2. Measure network resource timing for video chunks/streams
            if (window.performance && performance.getEntriesByType) {
                const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
                for (let i = this.lastResourceIndex; i < entries.length; i++) {
                    const entry = entries[i];
                    if (entry.transferSize > 0 && this.isMediaUrl(entry.name)) {
                        this.transferSamples.push({ timestamp: now, bytes: entry.transferSize });
                    }
                }
                this.lastResourceIndex = entries.length;
            }

            // 3. Keep samples within a 4-second sliding window
            this.transferSamples = this.transferSamples.filter(s => now - s.timestamp <= 4000);

            if (this.transferSamples.length > 0) {
                const totalBytes = this.transferSamples.reduce((acc, s) => acc + s.bytes, 0);
                const oldest = this.transferSamples[0].timestamp;
                const durationSec = Math.max(0.6, (now - oldest) / 1000);
                this.lastCalculatedBitrateBps = Math.round((totalBytes * 8) / durationSec);
                return;
            }

            // 4. Fallback: buffer advancement estimation
            const video = this.getVideo();
            if (video && video.buffered.length > 0) {
                let maxEnd = 0;
                for (let i = 0; i < video.buffered.length; i++) {
                    if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) {
                        maxEnd = video.buffered.end(i);
                        break;
                    }
                }

                if (this.lastBufferCheckTime > 0 && maxEnd > this.lastBufferedTime) {
                    const bufferedDeltaSeconds = maxEnd - this.lastBufferedTime;
                    const timeDeltaSec = (now - this.lastBufferCheckTime) / 1000;
                    if (timeDeltaSec > 0.5 && bufferedDeltaSeconds > 0) {
                        const nominalBitrate = this.activeMediaSource?.Bitrate || 4000000;
                        const throughputEstimate = (bufferedDeltaSeconds / timeDeltaSec) * nominalBitrate;
                        this.lastCalculatedBitrateBps = Math.round(throughputEstimate);
                    }
                }
                this.lastBufferedTime = maxEnd;
                this.lastBufferCheckTime = now;
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
