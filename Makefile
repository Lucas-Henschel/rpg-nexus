.DEFAULT_GOAL := up

.PHONY: bootstrap up down logs verify smoke reset-local

bootstrap:
	@if [ -e .env ]; then \
		printf '%s\n' '.env já existe; mantido sem alterações.'; \
	else \
		cp .env.example .env; \
		printf '%s\n' '.env criado a partir de .env.example.'; \
	fi

up:
	pnpm dev:detached

down:
	pnpm down

logs:
	docker compose logs --follow

verify:
	docker compose config --quiet
	pnpm validate:contracts

smoke:
	./scripts/smoke-local.sh

# DESTRUTIVO: remove os dados persistidos nos volumes deste projeto Compose.
reset-local:
	docker compose down --volumes --remove-orphans
