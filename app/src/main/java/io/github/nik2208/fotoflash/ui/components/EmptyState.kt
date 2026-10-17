package io.github.nik2208.fotoflash.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.nik2208.fotoflash.ui.theme.FfColors
import io.github.nik2208.fotoflash.ui.theme.FotoFlashTheme

/**
 * Stato vuoto (storico senza stampe, nessuna stampante accoppiata...): disco giallo con l'icona,
 * un alone a retino attorno (il motivo del brand), titolo, spiegazione e un'azione facoltativa.
 * L'azione compare solo se ci sono sia [actionText] sia [onAction].
 */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(modifier = Modifier.size(168.dp), contentAlignment = Alignment.Center) {
            HalftoneBurst(
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f),
                modifier = Modifier.matchParentSize(),
            )
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .background(color = FfColors.Flash, shape = CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = FfColors.Ink,
                    modifier = Modifier.size(44.dp),
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 320.dp),
        )
        if (actionText != null && onAction != null) {
            Spacer(Modifier.height(24.dp))
            FlashButton(text = actionText, onClick = onAction)
        }
    }
}

@Preview(name = "Stato vuoto - chiaro", showBackground = true, backgroundColor = 0xFFFBF8F1, widthDp = 360)
@Composable
private fun EmptyStatePreview() {
    FotoFlashTheme(darkTheme = false) {
        EmptyState(
            icon = Icons.Rounded.PhotoLibrary,
            title = "No prints yet",
            message = "Every photo you print or save shows up here, ready to print again.",
            actionText = "Take a photo",
            onAction = {},
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Preview(name = "Stato vuoto - scuro", showBackground = true, backgroundColor = 0xFF0E0C0A, widthDp = 360)
@Composable
private fun EmptyStateDarkPreview() {
    FotoFlashTheme(darkTheme = true) {
        EmptyState(
            icon = Icons.Rounded.PhotoLibrary,
            title = "No prints yet",
            message = "Every photo you print or save shows up here.",
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
