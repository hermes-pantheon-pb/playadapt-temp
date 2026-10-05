/**
 * SubtitleParser: Clean text parser and sanitizer for WebVTT, SubRip (SRT), and ASS/SSA.
 * Strips all typesetting, formatting codes, style overrides, and positioning tags
 * to yield pure, unadulterated clear-text cues.
 */

export interface SubtitleCue {
    start: number; // in seconds
    end: number;   // in seconds
    text: string;  // sanitized, clear text
}

export interface SubtitleTrackInfo {
    index: number;
    language?: string;
    title: string;
    codec: string;
    isDefault: boolean;
    isForced: boolean;
    isExternal: boolean;
    deliveryUrl?: string;
}

export class SubtitleParser {
    /**
     * Sanitizes raw subtitle text by stripping ASS override tags, HTML styling,
     * and cue positioning flags, leaving pure readable text.
     */
    public static cleanText(raw: string): string {
        if (!raw) return '';

        return raw
            // 1. Convert ASS hard line breaks and escaped breaks to standard newlines
            .replace(/\\N/gi, '\n')
            .replace(/\\n/gi, '\n')
            .replace(/\\h/gi, ' ')
            // 2. Remove all ASS style/override blocks e.g. {\an8}, {\pos(100,200)}, {\c&H00FFFF&}
            .replace(/\{[^\}]*?\}/g, '')
            // 3. Remove all HTML / XML markup e.g. <b>, <i>, <font color="...">, <c.yellow>
            .replace(/<[^>]*?>/g, '')
            // 4. Remove WebVTT voice tags e.g. <v Speaker>
            .replace(/<v[^>]*?>/g, '')
            // 5. Clean up extra spaces on lines
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
            .trim();
    }

    /**
     * Parses timestamp in format hh:mm:ss.ms or mm:ss.ms into seconds.
     */
    public static parseTimestamp(timeStr: string): number {
        if (!timeStr) return 0;

        const clean = timeStr.trim().replace(',', '.');
        const parts = clean.split(':');

        if (parts.length === 3) {
            const h = parseFloat(parts[0]) || 0;
            const m = parseFloat(parts[1]) || 0;
            const s = parseFloat(parts[2]) || 0;
            return h * 3600 + m * 60 + s;
        } else if (parts.length === 2) {
            const m = parseFloat(parts[0]) || 0;
            const s = parseFloat(parts[1]) || 0;
            return m * 60 + s;
        }

        return parseFloat(clean) || 0;
    }

    /**
     * Parses WebVTT or SRT formatted string into pure clear-text cues.
     */
    public static parseWebVttOrSrt(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        if (!content) return cues;

        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const blocks = normalized.split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length === 0) continue;

            // Find timestamp line (contains '-->')
            let timeLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) {
                    timeLineIdx = i;
                    break;
                }
            }

            if (timeLineIdx === -1) continue;

            const timeLine = lines[timeLineIdx];
            const parts = timeLine.split('-->');
            if (parts.length < 2) continue;

            // Strip any WebVTT cue settings like 'line:0 align:center'
            const rawStart = parts[0].trim();
            const rawEnd = parts[1].trim().split(/\s+/)[0];

            const start = this.parseTimestamp(rawStart);
            const end = this.parseTimestamp(rawEnd);

            if (end <= start) continue;

            const textLines = lines.slice(timeLineIdx + 1);
            const rawText = textLines.join('\n');
            const clean = this.cleanText(rawText);

            if (clean.length > 0) {
                cues.push({ start, end, text: clean });
            }
        }

        return cues;
    }

    /**
     * Parses Advanced SubStation Alpha (ASS / SSA) events into pure clear-text cues.
     */
    public static parseAssOrSsa(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        if (!content) return cues;

        const lines = content.replace(/\r\n/g, '\n').split('\n');
        let inEvents = false;
        let formatFields: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[')) {
                inEvents = trimmed.toLowerCase() === '[events]';
                continue;
            }

            if (!inEvents) continue;

            if (trimmed.toLowerCase().startsWith('format:')) {
                const formatStr = trimmed.substring(7).trim();
                formatFields = formatStr.split(',').map(f => f.trim().toLowerCase());
                continue;
            }

            if (trimmed.toLowerCase().startsWith('dialogue:')) {
                const dialogueStr = trimmed.substring(9).trim();
                // Number of comma splits is formatFields.length - 1 because text may contain commas
                const numParts = formatFields.length > 0 ? formatFields.length : 10;
                const parts: string[] = [];

                let current = '';
                let commaCount = 0;
                for (let i = 0; i < dialogueStr.length; i++) {
                    const char = dialogueStr[i];
                    if (char === ',' && commaCount < numParts - 1) {
                        parts.push(current);
                        current = '';
                        commaCount++;
                    } else {
                        current += char;
                    }
                }
                parts.push(current);

                let startIdx = formatFields.indexOf('start');
                let endIdx = formatFields.indexOf('end');
                let textIdx = formatFields.indexOf('text');

                // Fallbacks if format line was missing or non-standard
                if (startIdx === -1) startIdx = 1;
                if (endIdx === -1) endIdx = 2;
                if (textIdx === -1) textIdx = parts.length - 1;

                if (parts.length > Math.max(startIdx, endIdx, textIdx)) {
                    const start = this.parseTimestamp(parts[startIdx]);
                    const end = this.parseTimestamp(parts[endIdx]);
                    const clean = this.cleanText(parts[textIdx]);

                    if (end > start && clean.length > 0) {
                        cues.push({ start, end, text: clean });
                    }
                }
            }
        }

        return cues.sort((a, b) => a.start - b.start);
    }

    /**
     * Auto-detects subtitle format (WebVTT, SRT, ASS/SSA) and parses into pure text cues.
     */
    public static parse(content: string): SubtitleCue[] {
        if (!content) return [];

        const lower = content.trim().toLowerCase();
        if (lower.includes('[events]') || lower.includes('dialogue:')) {
            return this.parseAssOrSsa(content);
        }

        return this.parseWebVttOrSrt(content);
    }

    /**
     * Returns the active subtitle cue at a given timestamp in seconds.
     */
    public static getActiveCues(cues: SubtitleCue[], currentTime: number, offsetSeconds: number = 0): SubtitleCue[] {
        const adjustedTime = currentTime + offsetSeconds;
        return cues.filter(c => adjustedTime >= c.start && adjustedTime <= c.end);
    }
}
