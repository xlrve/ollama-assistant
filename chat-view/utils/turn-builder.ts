/**
 * turn-builder.ts
 * Helper for creating and updating Turn during generation
 */

import type { Turn } from '../types';

/**
 * Creates a new Turn when sending a user message
 */
export function createTurn(
    userMessageId: string,
    userContent: string,
    contextContent?: string,
    contextLabel?: string,
    contextStart?: number,
    contextEnd?: number,
    originalMessage?: string
): Turn {
    return {
        id: userMessageId, // Turn ID = user message ID
        user: {
            id: userMessageId,
            content: userContent,
            timestamp: Date.now(),
            contextContent,
            contextLabel,
            contextStart,
            contextEnd,
            originalMessage
        },
        systemMessages: [],
        errors: []
    };
}

/**
 * Adds reasoning to Turn
 */
export function addReasoningToTurn(turn: Turn, reasoningId: string, reasoningContent: string, collapsed: boolean = true): void {
    turn.reasoning = {
        id: reasoningId,
        content: reasoningContent,
        collapsed
    };
}

/**
 * Updates reasoning in Turn (creates if necessary)
 */
export function updateReasoningInTurn(
    turn: Turn,
    reasoningContent: string,
    collapsed: boolean = true,
    reasoningId?: string
): void {
    const trimmed = (reasoningContent || '').trim();
    if (!trimmed) return;

    if (!turn.reasoning) {
        turn.reasoning = {
            id: reasoningId || `${turn.id}-reasoning`,
            content: trimmed,
            collapsed
        };
        return;
    }

    turn.reasoning.content = trimmed;
    if (reasoningId) {
        turn.reasoning.id = reasoningId;
    }
    turn.reasoning.collapsed = collapsed;
}

/**
 * Adds assistant message to Turn
 */
export function addAssistantToTurn(
    turn: Turn,
    assistantId: string,
    content: string,
    status: 'queued' | 'streaming' | 'final' = 'final'
): void {
    turn.assistant = {
        id: assistantId,
        content,
        timestamp: Date.now(),
        status
    };
}

/**
 * Adds edit result to Turn (edit mode)
 */
export function addResultToTurn(
    turn: Turn,
    resultId: string,
    content: string,
    status: 'queued' | 'streaming' | 'final' = 'final',
    editNumber?: number,
    positionData?: {
        text: string;
        start: number;
        end: number;
        isWholeNote: boolean;
        anchorBefore?: string;
        anchorAfter?: string;
    }
): void {
    turn.result = {
        id: resultId,
        content,
        timestamp: Date.now(),
        status,
        editNumber,
        positionData
    };
}

/**
 * Adds system message to Turn (for Web mode - live statuses)
 */
export function addSystemMessageToTurn(turn: Turn, systemId: string, content: string): void {
    turn.systemMessages.push({
        id: systemId,
        content,
        timestamp: Date.now()
    });
}

/**
 * Adds stop message to Turn (always the last element)
 */
export function addStopMessageToTurn(turn: Turn, stopId: string, content: string): void {
    turn.stopMessage = {
        id: stopId,
        content,
        timestamp: Date.now()
    };
}

/**
 * Updates system message content (web status)
 */
export function updateSystemMessageContent(turn: Turn, systemId: string, content: string): void {
    const message = turn.systemMessages.find((msg) => msg.id === systemId);
    if (message) {
        message.content = content;
    }
}

/**
 * Adds error message to Turn
 */
export function addErrorToTurn(turn: Turn, errorId: string, content: string): void {
    turn.errors.push({
        id: errorId,
        content,
        timestamp: Date.now()
    });
}

