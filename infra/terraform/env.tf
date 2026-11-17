# Nomes das tabelas, lidos dos mesmos arquivos de ambiente que o Compose entrega a cada serviço
# (env_file). Assim o nome que o Terraform cria é sempre o nome que o serviço procura.
#
# Cada linha NOME=valor vira uma chave do mapa; comentários e linhas vazias são ignorados.
locals {
  env_line = "(?m)^([A-Z][A-Z0-9_]*)=(.*)$"

  campaigns_env = {
    for match in regexall(local.env_line, file("${path.module}/../../services/campaigns/.env.example")) :
    match[0] => trimspace(match[1])
  }

  characters_env = {
    for match in regexall(local.env_line, file("${path.module}/../../services/characters/.env.example")) :
    match[0] => trimspace(match[1])
  }
}
