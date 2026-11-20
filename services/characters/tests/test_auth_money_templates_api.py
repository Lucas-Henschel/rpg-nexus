"""API: login obrigatório, dono da ficha, dinheiro e modelos de ficha (templates)."""

from __future__ import annotations

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.security import sign_access_token  # noqa: E402

from .test_api import BODY, _create  # noqa: E402

SHEET = {
    "template": "fantasia",
    "header": {"level": "3", "money": "99"},
    "columns": [
        [
            {"id": "attrs", "type": "attributes", "title": "Atributos", "data": {}},
            {"id": "notas", "type": "text", "title": "Diário", "data": {"body": "segredo do personagem"}},
            {"id": "mana", "type": "counter", "title": "Mana", "data": {"current": 2, "max": 8}},
        ],
        [
            {"id": "rolls", "type": "dice", "title": "Ataques", "data": {"rolls": [{"label": "Espada", "expr": "1d8+2"}]}},
            {"id": "aliados", "type": "list", "title": "Aliados", "data": {"items": ["Bram"]}},
        ],
    ],
}
TEMPLATE = {
    "name": "Fantasia simples",
    "description": "Atributos, mana e ataques",
    "sheetDefinition": SHEET,
    "initialValues": {
        "attributes": {"forca": 10, "magia": 12},
        "skills": {"furtividade": 2},
        "hpMax": 18,
        "maxItems": 6,
        "currency": {"name": "Peças de ouro", "amount": 40},
    },
}


# --- login -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/characters?campaignId=c1"), ("post", "/characters"), ("get", "/templates"), ("get", "/campaigns/c1/roster")],
)
def test_rotas_exigem_login(anonymous, method, path):
    response = getattr(anonymous, method)(path, json=BODY) if method == "post" else getattr(anonymous, method)(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_saude_nao_exige_login(anonymous):
    assert anonymous.get("/health").status_code == 200


def test_token_expirado_ou_de_outro_emissor_e_recusado(anonymous, container):
    s = container.settings
    expired = sign_access_token(
        s.jwt_secret, issuer=s.jwt_issuer, audience=s.jwt_audience, user_id="u", username="u", now=1_000, ttl_seconds=60
    )
    foreign = sign_access_token(
        "outro-segredo-com-mais-de-trinta-e-dois-caracteres",
        issuer=s.jwt_issuer,
        audience=s.jwt_audience,
        user_id="u",
        username="u",
    )
    for token in (expired, foreign, "nao.e.jwt"):
        response = anonymous.get("/templates", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401


# --- dono da ficha ---------------------------------------------------------------------------------


def test_quem_cria_vira_dono_e_ninguem_mais_mexe(api, other):
    lyra = _create(api)
    assert lyra["ownerId"] == "user-ana"

    for response in (
        other.get(f"/characters/{lyra['id']}"),
        other.patch(f"/characters/{lyra['id']}", json={"name": "Roubada"}),
        other.get(f"/characters/{lyra['id']}/holds"),
        other.get(f"/characters/{lyra['id']}/money/transactions"),
        other.post(f"/characters/{lyra['id']}/money/adjustments", json={"delta": 100}),
    ):
        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "NOT_OWNER"
    assert api.get(f"/characters/{lyra['id']}").json()["name"] == "Lyra"


def test_listagem_mostra_so_as_minhas_fichas(api, other):
    _create(api, name="Da Ana")
    other.post("/characters", json={**BODY, "name": "Da Bia"})
    assert [c["name"] for c in api.get("/characters?campaignId=c1").json()["items"]] == ["Da Ana"]
    assert [c["name"] for c in other.get("/characters?campaignId=c1").json()["items"]] == ["Da Bia"]


def test_nao_da_para_criar_ou_passar_ficha_para_outra_pessoa(api):
    assert api.post("/characters", json={**BODY, "ownerId": "user-bia"}).json()["error"]["code"] == "OWNER_IMMUTABLE"
    lyra = _create(api)
    response = api.patch(f"/characters/{lyra['id']}", json={"ownerId": "user-bia"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "OWNER_IMMUTABLE"


# --- dinheiro --------------------------------------------------------------------------------------


def test_saldo_inicial_ajuste_pelo_dono_e_nunca_negativo(api):
    lyra = _create(api, currency={"name": "Moedas", "amount": 50})
    assert lyra["currency"] == {"name": "Moedas", "amount": 50}
    path = f"/characters/{lyra['id']}/money/adjustments"

    assert api.post(path, json={"delta": 20, "reason": "recompensa"}).json()["currency"]["amount"] == 70
    too_much = api.post(path, json={"delta": -100})
    assert too_much.status_code == 409 and too_much.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
    assert api.post(path, json={"delta": -70}).json()["currency"]["amount"] == 0
    assert api.post(path, json={"delta": 0}).status_code == 422

    kinds = [(m["kind"], m["amount"]) for m in api.get(f"/characters/{lyra['id']}/money/transactions").json()["items"]]
    assert kinds == [("ADJUSTMENT", 20), ("ADJUSTMENT", -70)]


def test_ajuste_com_idempotency_key_vale_uma_vez(api):
    lyra = _create(api)
    path = f"/characters/{lyra['id']}/money/adjustments"
    for _ in range(3):
        response = api.post(path, json={"delta": 15}, headers={"Idempotency-Key": "premio-sessao-4"})
        assert response.status_code == 200
    assert response.json()["currency"]["amount"] == 15


def test_patch_muda_o_nome_da_moeda_mas_nao_o_saldo(api):
    lyra = _create(api, currency={"name": "Moedas", "amount": 30})
    updated = api.patch(f"/characters/{lyra['id']}", json={"currencyName": "Créditos"}).json()
    assert updated["currency"] == {"name": "Créditos", "amount": 30}
    assert api.patch(f"/characters/{lyra['id']}", json={"currency": {"amount": 999}}).status_code == 422


# --- modelos ---------------------------------------------------------------------------------------


def test_modelo_guarda_estrutura_e_valores_iniciais_sem_dados_pessoais(api):
    created = api.post("/templates", json=TEMPLATE)
    assert created.status_code == 201, created.text
    template = created.json()
    assert template["version"] == 1 and template["visibility"] == "PRIVATE" and template["ownerId"] == "user-ana"

    blocks = {b["id"]: b for column in template["sheetDefinition"]["columns"] for b in column}
    assert blocks["notas"]["data"] == {}  # anotação pessoal fica de fora
    assert blocks["aliados"]["data"] == {"items": []}
    assert blocks["mana"]["data"] == {"max": 8, "current": 8}  # contador volta ao máximo
    assert blocks["rolls"]["data"]["rolls"] == [{"label": "Espada", "expr": "1d8+2"}]  # fórmula é estrutura
    assert template["sheetDefinition"]["header"] == {}

    assert [t["templateId"] for t in api.get("/templates").json()["items"]] == [template["templateId"]]


def test_modelo_e_privado(api, other):
    template = api.post("/templates", json=TEMPLATE).json()
    assert other.get(f"/templates/{template['templateId']}").status_code == 404
    assert other.get("/templates").json()["items"] == []
    response = other.post(f"/characters/from-template/{template['templateId']}", json={"campaignId": "c1", "name": "X"})
    assert response.status_code == 404


def test_ficha_criada_do_modelo_copia_a_versao_e_nao_muda_depois(api):
    template = api.post("/templates", json=TEMPLATE).json()
    tid = template["templateId"]

    lyra = api.post(f"/characters/from-template/{tid}", json={"campaignId": "c1", "name": "Lyra"})
    assert lyra.status_code == 201, lyra.text
    lyra = lyra.json()
    assert lyra["sourceTemplate"] == {"templateId": tid, "version": 1}
    assert lyra["attributes"] == {"forca": 10, "magia": 12}
    assert lyra["hp"] == {"current": 18, "max": 18}
    assert lyra["capacity"]["maxItems"] == 6
    assert lyra["currency"] == {"name": "Peças de ouro", "amount": 40}
    assert lyra["ownerId"] == "user-ana"

    v2 = api.patch(
        f"/templates/{tid}", json={"initialValues": {**TEMPLATE["initialValues"], "hpMax": 30}}, headers={"If-Match": '"1"'}
    )
    assert v2.status_code == 200 and v2.json()["version"] == 2

    # a ficha que já existia continua igual
    assert api.get(f"/characters/{lyra['id']}").json()["hp"] == {"current": 18, "max": 18}
    # fichas novas usam a versão atual, ou a pedida
    assert api.post(f"/characters/from-template/{tid}", json={"campaignId": "c1", "name": "Nova"}).json()["hp"]["max"] == 30
    old = api.post(f"/characters/from-template/{tid}", json={"campaignId": "c1", "name": "Antiga", "version": 1}).json()
    assert old["hp"]["max"] == 18 and old["sourceTemplate"]["version"] == 1
    assert api.get(f"/templates/{tid}?version=1").json()["initialValues"]["hpMax"] == 18


def test_edicao_do_modelo_com_versao_antiga_e_recusada(api):
    tid = api.post("/templates", json=TEMPLATE).json()["templateId"]
    api.patch(f"/templates/{tid}", json={"name": "Versão 2"})
    stale = api.patch(f"/templates/{tid}", json={"name": "Por cima"}, headers={"If-Match": '"1"'})
    assert stale.status_code == 412
    assert api.get(f"/templates/{tid}").json()["name"] == "Versão 2"


def test_modelo_apagado_some_da_lista_e_nao_cria_fichas(api):
    tid = api.post("/templates", json=TEMPLATE).json()["templateId"]
    lyra = api.post(f"/characters/from-template/{tid}", json={"campaignId": "c1", "name": "Lyra"}).json()
    assert api.delete(f"/templates/{tid}").status_code == 204
    assert api.get("/templates").json()["items"] == []
    assert api.post(f"/characters/from-template/{tid}", json={"campaignId": "c1", "name": "X"}).status_code == 404
    assert api.get(f"/characters/{lyra['id']}").json()["sourceTemplate"]["templateId"] == tid  # a ficha segue intacta


def test_criar_do_modelo_e_idempotente(api):
    tid = api.post("/templates", json=TEMPLATE).json()["templateId"]
    path, body = f"/characters/from-template/{tid}", {"campaignId": "c1", "name": "Lyra"}
    first = api.post(path, json=body, headers={"Idempotency-Key": "k1"})
    again = api.post(path, json=body, headers={"Idempotency-Key": "k1"})
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]


def test_mesma_idempotency_key_de_pessoas_diferentes_nao_colide(api, other):
    a = api.post("/characters", json=BODY, headers={"Idempotency-Key": "igual"})
    b = other.post("/characters", json=BODY, headers={"Idempotency-Key": "igual"})
    assert (a.status_code, b.status_code) == (201, 201)
    assert a.json()["id"] != b.json()["id"]


# --- Autorização pela campanha (participantes vindos dos eventos do S1) --------------------------


def test_so_quem_participa_cria_ficha_na_campanha(api, container):
    response = api.post("/characters", json={**BODY, "campaignId": "de-outra-mesa"})
    assert response.status_code == 403 and response.json()["error"]["code"] == "NOT_CAMPAIGN_MEMBER"
    tid = api.post("/templates", json=TEMPLATE).json()["templateId"]
    from_template = api.post(f"/characters/from-template/{tid}", json={"campaignId": "de-outra-mesa", "name": "X"})
    assert from_template.status_code == 403
    assert api.get("/characters?campaignId=de-outra-mesa").status_code == 403
    assert api.get("/campaigns/de-outra-mesa/roster").status_code == 403


def test_quem_saiu_da_campanha_nao_cria_mais_ficha(api, container):
    from .conftest import member_removed

    _create(api)
    container.handlers.dispatch(member_removed("c1", "user-ana"))
    response = api.post("/characters", json=BODY)
    assert response.status_code == 403 and response.json()["error"]["code"] == "NOT_CAMPAIGN_MEMBER"


def test_so_o_dono_da_ficha_ajusta_o_dinheiro(api, gm):
    lyra = _create(api, currency={"amount": 10})
    assert lyra["access"] == {"edit": True, "adjustMoney": True}
    response = gm.post(f"/characters/{lyra['id']}/money/adjustments", json={"delta": 1000})
    assert response.status_code == 403 and response.json()["error"]["code"] == "NOT_OWNER"
    assert api.get(f"/characters/{lyra['id']}").json()["currency"]["amount"] == 10


def test_mestre_le_as_fichas_da_campanha_mas_nao_edita(api, other, gm):
    lyra = _create(api, name="Da Ana")
    other.post("/characters", json={**BODY, "name": "Da Bia"})

    assert sorted(c["name"] for c in gm.get("/characters?campaignId=c1").json()["items"]) == ["Da Ana", "Da Bia"]
    seen = gm.get(f"/characters/{lyra['id']}")
    assert seen.status_code == 200 and seen.json()["access"] == {"edit": False, "adjustMoney": False}
    assert gm.get(f"/characters/{lyra['id']}/money/transactions").status_code == 200
    assert gm.get(f"/characters/{lyra['id']}/holds").status_code == 200

    edit = gm.patch(f"/characters/{lyra['id']}", json={"name": "Mudada pelo mestre"})
    assert edit.status_code == 403 and edit.json()["error"]["code"] == "NOT_OWNER"
    # o jogador continua vendo só a dele
    assert [c["name"] for c in other.get("/characters?campaignId=c1").json()["items"]] == ["Da Bia"]


def test_mestre_de_uma_campanha_nao_le_ficha_de_outra(api, container):
    from .conftest import member_joined, token_for

    lyra = _create(api)  # campanha c1
    container.handlers.dispatch(member_joined("c9", "user-outro-mestre", "OWNER"))
    from fastapi.testclient import TestClient

    from app.main import create_app

    headers = {"Authorization": f"Bearer {token_for(container, 'user-outro-mestre', 'outro')}"}
    with TestClient(create_app(container=container), headers=headers) as stranger:
        assert stranger.get(f"/characters/{lyra['id']}").status_code == 403
        assert stranger.post(f"/characters/{lyra['id']}/money/adjustments", json={"delta": 5}).status_code == 403
