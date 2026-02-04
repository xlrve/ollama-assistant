import type { EditPosition } from '../state/types';

export function updateChainPositionsInMap(
    editSet: Set<number>,
    newContent: string,
    newStart: number,
    getPosition: (editNumber: number) => EditPosition | undefined,
    setPosition: (editNumber: number, position: EditPosition) => void
): void {
    const newEnd = newStart + newContent.length;

    for (const chainEditNum of editSet) {
        const currentPosition = getPosition(chainEditNum);
        if (!currentPosition) continue;

        const updatedPosition: EditPosition = {
            ...currentPosition,
            appliedContent: newContent,
            appliedStart: newStart,
            appliedEnd: newEnd
        };
        setPosition(chainEditNum, updatedPosition);
    }
}

export function shiftUntouchedPositionsAfterReplaceInMap(
    replaceFrom: number,
    replaceTo: number,
    insertedLength: number,
    touchedEdits: Set<number>,
    positions: Iterable<[number, EditPosition]>,
    setPosition: (editNumber: number, position: EditPosition) => void
): void {
    const delta = insertedLength - (replaceTo - replaceFrom);
    if (delta === 0) return;

    for (const [editNum, position] of positions) {
        if (touchedEdits.has(editNum)) continue;

        let changed = false;
        const updated: EditPosition = { ...position };

        if (position.start >= replaceTo && position.end >= replaceTo) {
            updated.start = position.start + delta;
            updated.end = position.end + delta;
            changed = true;
        }

        if (
            position.appliedStart !== undefined &&
            position.appliedEnd !== undefined &&
            position.appliedStart >= replaceTo &&
            position.appliedEnd >= replaceTo
        ) {
            updated.appliedStart = position.appliedStart + delta;
            updated.appliedEnd = position.appliedEnd + delta;
            changed = true;
        }

        if (changed) {
            setPosition(editNum, updated);
        }
    }
}
