import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { pickDocument, takePhoto, type PickedDocument } from "@/lib/files";
import { colors } from "@/theme";

/** Human-readable file size, shared by every screen that lists attachments. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentListItem {
  id: string;
  originalFileName: string;
  sizeBytes: number;
  storedPath: string;
  mimeType: string;
}

export interface AttachmentListProps {
  attachments: AttachmentListItem[];
  busy: boolean;
  onPick: (picked: PickedDocument) => void;
  onOpen: (attachment: AttachmentListItem) => void;
  onRemove: (attachmentId: string) => void;
}

export function AttachmentList({
  attachments,
  busy,
  onPick,
  onOpen,
  onRemove,
}: AttachmentListProps) {
  const [picking, setPicking] = useState(false);
  const [takingPhoto, setTakingPhoto] = useState(false);

  async function handlePickPress() {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (picked) onPick(picked);
    } finally {
      setPicking(false);
    }
  }

  async function handleTakePhotoPress() {
    setTakingPhoto(true);
    try {
      const picked = await takePhoto();
      if (picked) onPick(picked);
    } finally {
      setTakingPhoto(false);
    }
  }

  return (
    <View style={styles.container}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.row}>
          <TouchableOpacity style={styles.info} disabled={busy} onPress={() => onOpen(attachment)}>
            <Text style={styles.name} numberOfLines={1}>
              {attachment.originalFileName}
            </Text>
            <Text style={styles.size}>{formatFileSize(attachment.sizeBytes)}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => onRemove(attachment.id)}>
            <Text style={styles.remove}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        style={styles.addButton}
        disabled={busy || picking || takingPhoto}
        onPress={handlePickPress}
      >
        <Text style={styles.addButtonText}>
          {picking ? "Abriendo selector…" : "Añadir archivo"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.addButton}
        disabled={busy || picking || takingPhoto}
        onPress={handleTakePhotoPress}
      >
        <Text style={styles.addButtonText}>{takingPhoto ? "Abriendo cámara…" : "Tomar foto"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, paddingVertical: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  info: { flex: 1, marginRight: 8 },
  name: { fontSize: 15, color: colors.text },
  size: { fontSize: 12, color: colors.textMuted },
  remove: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  addButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  addButtonText: { color: colors.primary, fontWeight: "600" },
});
