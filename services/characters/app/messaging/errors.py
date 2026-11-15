"""Classificação de falhas no consumo: decide entre retry e DLQ."""

from __future__ import annotations


class PoisonMessage(Exception):
    """Mensagem que nunca será processada com sucesso (JSON inválido, schema, tipo/versão desconhecidos).

    Por padrão ela ainda passa pelas N tentativas configuradas (exigência da demonstração F4);
    com ``POISON_DIRECT_TO_DLQ=true`` vai direto para a DLQ.
    """


class TransientProcessingError(Exception):
    """Falha temporária (ex.: conflitos de concorrência persistentes); vale tentar novamente."""
