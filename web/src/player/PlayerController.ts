/**
 * PlayerController: Non-intrusive interface with Jellyfin's official video player,
 * providing clean access to playback rate, stream stats, video canvas frame capture,
 * media events, rich stream codec inspection, HDR/Dolby Vision flags, and real-time bitrate.
 */

import { SubtitleCue, SubtitleTrackInfo, SubtitleParser } from './SubtitleParser';

export interface DetailedMediaInfo {
    videoCodec: string;
    originalVideoCodec: string;
    targetVideoCodec?: string;
    isVideoDirect: boolean;
    videoProfile?: string;
    resolutionText: string;
    bitDepthText?: string;
    isHdr: boolean;
    hdrFlags: string[];
    doviTitle?: string;
    colorSpace?: string;

    // Tone Mapping
    isToneMapping: boolean;
    toneMappingDetails?: string;

    audioCodec: string;
    originalAudioCodec: string;
    targetAudioCodec?: string;
    isAudioDirect: boolean;
    audioProfile?: string;
    audioChannelsText: string;

    playbackMethod: 'Direct Play' | 'Direct Stream' | 'Transcode';
    transcodeScope: 'None' | 'Audio' | 'Video' | 'All';
    transcodeReason?: string;
    hardwareAcceleration?: string;
    container?: string;

    nominalBitrateBps: number;
    streamBitrateBps: number;
    networkBitrateBps: number;
    realtimeBitrateBps: number;
    formattedRealtimeBitrate: string;
    formattedStreamBitrate: string;
}

export function normalizeVideoCodec(raw?: string): string {
    if (!raw) return '';
    const upper = raw.toUpperCase().trim();
    if (upper === 'H264' || upper === 'AVC') return 'H.264';
    if (upper === 'HEVC' || upper === 'H265') return 'HEVC';
    if (upper === 'AV01' || upper === 'AV1') return 'AV1';
    if (upper === 'VP09' || upper === 'VP9') return 'VP9';
    if (upper === 'VP8') return 'VP8';
    if (upper === 'VC1' || upper === 'VC-1') return 'VC-1';
    if (upper === 'MPEG2VIDEO' || upper === 'MPEG2') return 'MPEG-2';
    if (upper === 'MPEG4') return 'MPEG-4';
    return upper;
}

export function normalizeAudioCodec(raw?: string): string {
    if (!raw) return '';
    const upper = raw.toUpperCase().trim();
    if (upper === 'OPUS') return 'OPUS';
    if (upper === 'FLAC') return 'FLAC';
    if (upper === 'TRUEHD') return 'Dolby TrueHD';
    if (upper === 'EAC3') return 'E-AC-3';
    if (upper === 'AC3') return 'AC-3';
    if (upper === 'DCA' || upper === 'DTS') return 'DTS';
    if (upper === 'VORBIS') return 'Vorbis';
    if (upper === 'MP3') return 'MP3';
    if (upper === 'AAC') return 'AAC';
    if (upper === 'ALAC') return 'ALAC';
    if (upper === 'WAV' || upper === 'PCM') return 'PCM';
    return upper;
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
    private lastTransferActivityTime: number = 0;
    private bitrateTrackerInterval: any = null;
    private cachedSubtitleCues: Map<number, SubtitleCue[]> = new Map();

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
            this.cachedSubtitleCues.clear();
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
            this.cachedSubtitleCues.clear();
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
        this.lastTransferActivityTime = now;
    }

    public getVideo(): HTMLVideoElement | null {
        if (this.videoElement && document.contains(this.videoElement) && this.videoElement.videoWidth > 0) {
            return this.videoElement;
        }

        const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
        const activeVideo = videos.find(v => v.videoWidth > 0 && !v.paused) ||
                            videos.find(v => v.videoWidth > 0) ||
                            (document.querySelector('video.htmlvideoplayer, video') as HTMLVideoElement);

        if (activeVideo) {
            this.videoElement = activeVideo;
            this.attachVideoListeners(activeVideo);
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
     * Discovers all available subtitle tracks on the currently playing media item.
     */
    public getSubtitleTracks(): SubtitleTrackInfo[] {
        const pbManager = this.getPlaybackManager();
        const player = this.activePlayer || (pbManager?.getCurrentPlayer ? pbManager.getCurrentPlayer() : null);

        let mediaStreams: any[] = [];
        if (this.activeMediaSource?.MediaStreams?.length) {
            mediaStreams = this.activeMediaSource.MediaStreams;
        } else if (this.activeNowPlayingItem?.MediaStreams?.length) {
            mediaStreams = this.activeNowPlayingItem.MediaStreams;
        } else if (pbManager?.mediaStreams) {
            try {
                mediaStreams = pbManager.mediaStreams(player) || [];
            } catch (e) {}
        }

        const subStreams = mediaStreams.filter((s: any) => s.Type === 'Subtitle');
        return subStreams.map((s: any) => ({
            index: typeof s.Index === 'number' ? s.Index : -1,
            language: s.Language,
            title: s.DisplayTitle || s.Title || s.Language || `Track ${s.Index}`,
            codec: (s.Codec || 'vtt').toLowerCase(),
            isDefault: s.IsDefault === true,
            isForced: s.IsForced === true,
            isExternal: s.IsExternal === true,
            deliveryUrl: s.DeliveryUrl
        })).filter((t: SubtitleTrackInfo) => t.index !== -1);
    }

    /**
     * Reads the current primary subtitle stream index selected by Jellyfin.
     * Strictly read-only to ensure we never alter primary subtitle behavior.
     */
    public getPrimarySubtitleIndex(): number {
        const pbManager = this.getPlaybackManager();
        const player = this.activePlayer || (pbManager?.getCurrentPlayer ? pbManager.getCurrentPlayer() : null);
        if (pbManager?.getSubtitleStreamIndex) {
            try {
                const idx = pbManager.getSubtitleStreamIndex(player);
                if (typeof idx === 'number') return idx;
            } catch (e) {}
        }
        return -1;
    }

    /**
     * Fetches and parses subtitle cues for a secondary subtitle stream cleanly.
     * Converts to pure clear-text cues via SubtitleParser. Caches per track index.
     */
    public async fetchSubtitleCues(trackIndex: number): Promise<SubtitleCue[]> {
        if (this.cachedSubtitleCues.has(trackIndex)) {
            return this.cachedSubtitleCues.get(trackIndex)!;
        }

        const tracks = this.getSubtitleTracks();
        const track = tracks.find(t => t.index === trackIndex);
        if (!track) return [];

        let url = track.deliveryUrl || '';
        const apiClient = (window as any).ApiClient;

        if (!url && apiClient) {
            const itemId = this.activeNowPlayingItem?.Id || this.activeMediaSource?.ItemId || this.activeSession?.NowPlayingItem?.Id;
            const mediaSourceId = this.activeMediaSource?.Id;
            if (itemId && mediaSourceId) {
                // Jellyfin's Stream.vtt endpoint automatically converts text/SRT/ASS to clean WebVTT
                if (typeof apiClient.getUrl === 'function') {
                    url = apiClient.getUrl(`Videos/${itemId}/${mediaSourceId}/Subtitles/${trackIndex}/Stream.vtt`);
                } else if (typeof apiClient.serverAddress === 'function') {
                    url = `${apiClient.serverAddress()}/Videos/${itemId}/${mediaSourceId}/Subtitles/${trackIndex}/Stream.vtt`;
                }
            }
        }

        if (!url) return [];

        try {
            const headers: Record<string, string> = {};
            if (apiClient?.accessToken?.()) {
                headers['X-Emby-Token'] = apiClient.accessToken();
            }

            const res = await fetch(url, { headers });
            if (!res.ok) {
                console.warn('[PlayAdapt] Failed to fetch secondary subtitle stream:', res.status);
                return [];
            }

            const content = await res.text();
            const cues = SubtitleParser.parse(content);
            this.cachedSubtitleCues.set(trackIndex, cues);
            return cues;
        } catch (err) {
            console.error('[PlayAdapt] Error loading subtitle track:', err);
            return [];
        }
    }

    /**
     * Captures the current video frame cleanly as a lossless or compressed image without any OSD.
     * Uses native canvas toBlob and generates a Blob URL for full Firefox/Linux compatibility.
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
                        const dataUrl = URL.createObjectURL(blob);
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

        // 3. Resolve MediaStreams from MediaSource, Item, or playbackManager
        let mediaStreams: any[] = [];
        if (mediaSource?.MediaStreams?.length) {
            mediaStreams = mediaSource.MediaStreams;
        } else if (nowPlayingItem?.MediaStreams?.length) {
            mediaStreams = nowPlayingItem.MediaStreams;
        } else if (pbManager?.mediaStreams) {
            try {
                mediaStreams = pbManager.mediaStreams(player) || [];
            } catch (e) {
                // Ignore
            }
        }

        const videoStream = mediaStreams.find((s: any) => s.Type === 'Video') || {};

        // 4. Resolve TranscodingInfo from Session, playbackManager, or player
        const session = this.activeSession;
        let transcodeInfo = session?.TranscodingInfo;
        if (!transcodeInfo && pbManager?.getTranscodingInfo) {
            try {
                transcodeInfo = pbManager.getTranscodingInfo(player);
            } catch (e) {}
        }
        if (!transcodeInfo && player?.getTranscodingInfo) {
            try {
                transcodeInfo = player.getTranscodingInfo();
            } catch (e) {}
        }
        if (!transcodeInfo && player?._transcodingInfo) {
            transcodeInfo = player._transcodingInfo;
        }
        if (!transcodeInfo && player?._currentPlayOptions?.transcodingInfo) {
            transcodeInfo = player._currentPlayOptions.transcodingInfo;
        }

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
        } else if (videoStream.Width && videoStream.Height) {
            if (videoStream.Width >= 3800 || videoStream.Height >= 2100) resolutionText = '4K UHD';
            else if (videoStream.Width >= 1800 || videoStream.Height >= 1000) resolutionText = '1080p FHD';
            else if (videoStream.Width >= 1200 || videoStream.Height >= 700) resolutionText = '720p HD';
            else resolutionText = `${videoStream.Width}x${videoStream.Height}`;
        }

        // Video Codec Resolution (Original vs Target)
        const originalVideoCodec = normalizeVideoCodec(videoStream.Codec || videoStream.codec);
        let targetVideoCodec = normalizeVideoCodec(transcodeInfo?.VideoCodec);

        const srcUrl = video?.src || mediaSource?.TranscodingUrl || '';
        if (!targetVideoCodec && srcUrl) {
            const vMatch = srcUrl.match(/[?&]VideoCodec=([^&]+)/i);
            if (vMatch) {
                targetVideoCodec = normalizeVideoCodec(decodeURIComponent(vMatch[1]).split(',')[0]);
            }
        }

        // Bit Depth
        const bitDepth = videoStream.BitDepth ? `${videoStream.BitDepth}-bit` : undefined;

        // HDR & Special Video Flags
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

        // Audio Codec Resolution (Original vs Target)
        const audioStreamIndex = pbManager?.getAudioStreamIndex ? pbManager.getAudioStreamIndex(player) : -1;
        const audioTracks = pbManager?.audioTracks ? pbManager.audioTracks(player) : [];
        const audioStream = audioTracks.find((s: any) => s.Index === audioStreamIndex) ||
                            mediaStreams.find((s: any) => s.Type === 'Audio') || {};

        const originalAudioCodec = normalizeAudioCodec(audioStream.Codec || audioStream.codec);
        let targetAudioCodec = normalizeAudioCodec(transcodeInfo?.AudioCodec);
        if (!targetAudioCodec && srcUrl) {
            const aMatch = srcUrl.match(/[?&]AudioCodec=([^&]+)/i);
            if (aMatch) {
                targetAudioCodec = normalizeAudioCodec(decodeURIComponent(aMatch[1]).split(',')[0]);
            }
        }

        let audioProfile = audioStream.Profile || undefined;
        if (originalAudioCodec === 'Dolby TrueHD' && (audioProfile?.toLowerCase().includes('atmos') || videoStream.Title?.includes('Atmos') || audioStream.Title?.includes('Atmos'))) {
            audioProfile = 'Atmos';
        } else if (originalAudioCodec === 'E-AC-3' && (audioProfile?.toLowerCase().includes('atmos') || audioStream.Title?.includes('Atmos'))) {
            audioProfile = 'Atmos';
        } else if (originalAudioCodec === 'DTS') {
            if (audioProfile?.includes('MA') || audioProfile?.includes('Master')) {
                audioProfile = 'HD-MA';
            } else if (audioProfile?.includes('X')) {
                audioProfile = 'DTS:X';
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

        // Playback Method & Direct Stream / Transcoding Breakdown
        const playMethodStr = pbManager?.getPlaybackMethod ? pbManager.getPlaybackMethod(player) : (session?.PlayState?.PlayMethod || null);
        let isVideoDirect = true;
        let isAudioDirect = true;
        let hardwareAcceleration = transcodeInfo?.HardwareAccelerationType ? transcodeInfo.HardwareAccelerationType.toUpperCase() : undefined;
        let transcodeReason = (transcodeInfo?.TranscodeReasons && transcodeInfo.TranscodeReasons.length) ? transcodeInfo.TranscodeReasons.join(', ') : undefined;

        if (transcodeInfo) {
            if (typeof transcodeInfo.IsVideoDirect === 'boolean') {
                isVideoDirect = transcodeInfo.IsVideoDirect;
            } else if (transcodeInfo.VideoCodec && originalVideoCodec) {
                isVideoDirect = targetVideoCodec === originalVideoCodec;
            }

            if (typeof transcodeInfo.IsAudioDirect === 'boolean') {
                isAudioDirect = transcodeInfo.IsAudioDirect;
            } else if (transcodeInfo.AudioCodec && originalAudioCodec) {
                isAudioDirect = targetAudioCodec === originalAudioCodec;
            }
        } else if (playMethodStr === 'DirectStream') {
            isVideoDirect = true;
            isAudioDirect = false;
        } else if (playMethodStr === 'Transcode' || srcUrl.includes('/master.m3u8')) {
            isVideoDirect = false;
            isAudioDirect = false;
        }

        let playbackMethod: 'Direct Play' | 'Direct Stream' | 'Transcode' = 'Direct Play';
        let transcodeScope: 'None' | 'Audio' | 'Video' | 'All' = 'None';

        if (!isVideoDirect && !isAudioDirect) {
            playbackMethod = 'Transcode';
            transcodeScope = 'All';
        } else if (!isVideoDirect && isAudioDirect) {
            playbackMethod = 'Transcode';
            transcodeScope = 'Video';
        } else if (isVideoDirect && !isAudioDirect) {
            playbackMethod = 'Direct Stream';
            transcodeScope = 'Audio';
        } else {
            if (playMethodStr === 'DirectStream' || srcUrl.includes('Static=true')) {
                playbackMethod = 'Direct Stream';
                transcodeScope = 'None';
            } else {
                playbackMethod = 'Direct Play';
                transcodeScope = 'None';
            }
        }

        const videoCodec = targetVideoCodec && !isVideoDirect && targetVideoCodec !== originalVideoCodec
            ? targetVideoCodec
            : (originalVideoCodec || 'Video');
        const audioCodec = targetAudioCodec && !isAudioDirect && targetAudioCodec !== originalAudioCodec
            ? targetAudioCodec
            : (originalAudioCodec || 'Audio');

        // Bitrate Metrics: nominal stream bitrate vs live network throughput
        const streamBitrateBps = transcodeInfo?.Bitrate || mediaSource?.Bitrate || (videoStream.BitRate ? videoStream.BitRate + (audioStream.BitRate || 0) : 0);
        const networkBitrateBps = this.lastCalculatedBitrateBps;
        const realtimeBitrateBps = networkBitrateBps > 0 ? networkBitrateBps : 0;

        // Tone Mapping Detection
        // Active when HDR source media is being transcoded down, or when explicitly flagged in transcode reasons
        const hasHdrSource = isHdr || (videoStream.VideoRangeType && videoStream.VideoRangeType !== 'SDR') || (videoStream.VideoRange === 'HDR');
        const isVideoTranscoding = !isVideoDirect || playbackMethod === 'Transcode';
        const reasonsContainRange = transcodeReason ? (transcodeReason.includes('Range') || transcodeReason.includes('ColorSpace')) : false;

        const isToneMapping = hasHdrSource && (isVideoTranscoding || reasonsContainRange);
        let toneMappingDetails = '';
        if (isToneMapping) {
            toneMappingDetails = hardwareAcceleration ? `${hardwareAcceleration} Tone Mapping` : 'Tone Mapping';
        }

        return {
            videoCodec,
            originalVideoCodec: originalVideoCodec || 'Video',
            targetVideoCodec: targetVideoCodec || undefined,
            isVideoDirect,
            videoProfile: videoStream.Profile,
            resolutionText,
            bitDepthText: bitDepth,
            isHdr,
            hdrFlags,
            doviTitle,
            colorSpace,
            isToneMapping,
            toneMappingDetails: isToneMapping ? toneMappingDetails : undefined,
            audioCodec,
            originalAudioCodec: originalAudioCodec || 'Audio',
            targetAudioCodec: targetAudioCodec || undefined,
            isAudioDirect,
            audioProfile,
            audioChannelsText,
            playbackMethod,
            transcodeScope,
            transcodeReason,
            hardwareAcceleration,
            container: (mediaSource?.Container || 'MKV').toUpperCase(),
            nominalBitrateBps: streamBitrateBps,
            streamBitrateBps,
            networkBitrateBps,
            realtimeBitrateBps,
            formattedRealtimeBitrate: this.formatBitrate(networkBitrateBps),
            formattedStreamBitrate: this.formatBitrate(streamBitrateBps)
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
     * 1. Inspects PerformanceResourceTiming transferSize deltas for media segments.
     * 2. Smooths active chunk arrivals using a rolling window and EMA clamp.
     * 3. Decays to 0.0 Mbps when idle/buffered so the counter never freezes on buffer bursts.
     */
    private startBitrateTracker(): void {
        if (this.bitrateTrackerInterval) return;

        this.bitrateTrackerInterval = setInterval(() => {
            const now = Date.now();
            const video = this.getVideo();

            // Refresh active session periodically during playback so transcode info stays live
            if (video && !video.paused && (now - this.lastSessionFetchTime > 3500)) {
                this.fetchActiveSession();
            }

            // 1. Process performance resource timings
            if (window.performance && performance.getEntriesByType) {
                const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
                for (let i = this.lastResourceIndex; i < entries.length; i++) {
                    const entry = entries[i];
                    if (entry.transferSize > 0 && this.isMediaUrl(entry.name)) {
                        this.transferSamples.push({ timestamp: now, bytes: entry.transferSize });
                        this.lastTransferActivityTime = now;
                    }
                }
                this.lastResourceIndex = entries.length;
            }

            // 2. Keep samples within a 2.5-second sliding window
            this.transferSamples = this.transferSamples.filter(s => now - s.timestamp <= 2500);

            // 3. Compute live network throughput
            if (this.transferSamples.length > 0) {
                const totalBytes = this.transferSamples.reduce((acc, s) => acc + s.bytes, 0);
                const oldest = this.transferSamples[0].timestamp;
                const windowSec = Math.max(1.0, (now - oldest) / 1000);
                const rawBps = Math.round((totalBytes * 8) / windowSec);

                // Clamp excessive spikes from local cache or chunk batches (max 120 Mbps)
                const clampedBps = Math.min(rawBps, 120000000);

                if (this.lastCalculatedBitrateBps > 0) {
                    this.lastCalculatedBitrateBps = Math.round(this.lastCalculatedBitrateBps * 0.35 + clampedBps * 0.65);
                } else {
                    this.lastCalculatedBitrateBps = clampedBps;
                }
            } else {
                // If no transfer activity occurred in the last 2 seconds:
                // Decays to 0 bps so the display shows 0.0 Mbps when idle/buffered
                if (now - this.lastTransferActivityTime > 2000) {
                    this.lastCalculatedBitrateBps = 0;
                }
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
