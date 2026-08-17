.PHONY: docker-dev docker-stop docker-restart help

## Docker dev: hot-reload, bind mounts (Linux + macOS)
docker-dev:
	docker compose up --build

## Docker: stop all containers
docker-stop:
	docker compose down

## Docker: restart dev
docker-restart: docker-stop docker-dev

## Show this help
help:
	@grep -E '^## ' Makefile | sed 's/^## /  /'
