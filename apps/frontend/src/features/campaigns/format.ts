const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
