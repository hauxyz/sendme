package api

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/config"
	"github.com/hauxyz/sendme/server/internal/crypto"
	"github.com/hauxyz/sendme/server/internal/httpx"
	"github.com/hauxyz/sendme/server/internal/mailer"
	"github.com/hauxyz/sendme/server/internal/queue"
	"github.com/hauxyz/sendme/server/internal/tracking"
)

type Server struct {
	cfg     *config.Config
	db      *pgxpool.Pool
	queue   *queue.Client
	tokens  *auth.Tokens
	sealer  *crypto.Sealer
	mailer  *mailer.Service
	tracker *tracking.Service
	logger  *slog.Logger
}

func New(cfg *config.Config, db *pgxpool.Pool, q *queue.Client, tokens *auth.Tokens, sealer *crypto.Sealer, mailerSvc *mailer.Service, tracker *tracking.Service, logger *slog.Logger) *Server {
	return &Server{cfg: cfg, db: db, queue: q, tokens: tokens, sealer: sealer, mailer: mailerSvc, tracker: tracker, logger: logger}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(s.requestLogger)
	r.Use(recoverer)
	r.Use(s.cors)
	r.Use(securityHeaders)

	r.Get("/healthz", s.health)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"name": "SendMe API", "status": "ok"})
	})

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/register", s.register)
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)

		r.Group(func(r chi.Router) {
			r.Use(s.requireSession)
			r.Get("/auth/me", s.me)

			r.Patch("/profile", s.updateProfile)
			r.Post("/profile/password", s.changePassword)
			r.Patch("/workspace", s.updateWorkspace)

			r.Get("/domains", s.listDomains)
			r.Post("/domains", s.createDomain)
			r.Get("/domains/{id}", s.getDomain)
			r.Patch("/domains/{id}", s.updateDomain)
			r.Delete("/domains/{id}", s.deleteDomain)
			r.Post("/domains/{id}/test", s.testDomain)
			r.Get("/domains/{id}/dns", s.domainDNS)

			r.Get("/contacts", s.listContacts)
			r.Post("/contacts", s.createContact)
			r.Post("/contacts/import", s.importContacts)
			r.Get("/contacts/{id}", s.getContact)
			r.Patch("/contacts/{id}", s.updateContact)
			r.Delete("/contacts/{id}", s.deleteContact)

			r.Get("/audiences", s.listAudiences)
			r.Post("/audiences", s.createAudience)
			r.Get("/audiences/{id}", s.getAudience)
			r.Patch("/audiences/{id}", s.updateAudience)
			r.Delete("/audiences/{id}", s.deleteAudience)
			r.Post("/audiences/{id}/contacts", s.addAudienceContacts)
			r.Delete("/audiences/{id}/contacts/{contactID}", s.removeAudienceContact)

			r.Get("/campaigns", s.listCampaigns)
			r.Post("/campaigns", s.createCampaign)
			r.Get("/campaigns/{id}", s.getCampaign)
			r.Patch("/campaigns/{id}", s.updateCampaign)
			r.Delete("/campaigns/{id}", s.deleteCampaign)
			r.Post("/campaigns/{id}/send", s.sendCampaign)
			r.Post("/campaigns/{id}/cancel", s.cancelCampaign)

			r.Get("/emails", s.listEmails)
			r.Post("/emails", s.sendDashboardEmail)
			r.Get("/emails/{id}", s.getEmail)
			r.Post("/emails/{id}/retry", s.retryEmail)

			r.Get("/api-keys", s.listAPIKeys)
			r.Post("/api-keys", s.createAPIKey)
			r.Delete("/api-keys/{id}", s.deleteAPIKey)

			r.Get("/webhooks", s.listWebhooks)
			r.Post("/webhooks", s.createWebhook)
			r.Get("/webhooks/{id}", s.getWebhook)
			r.Patch("/webhooks/{id}", s.updateWebhook)
			r.Delete("/webhooks/{id}", s.deleteWebhook)
			r.Post("/webhooks/{id}/test", s.testWebhook)
			r.Get("/webhooks/{id}/deliveries", s.listWebhookDeliveries)

			r.Get("/analytics", s.analytics)
		})

		r.Route("/v1", func(r chi.Router) {
			r.Use(s.requireAPIKey)
			r.Get("/me", s.v1Me)
			r.Get("/domains", s.v1Domains)
			r.Post("/emails", s.v1SendEmail)
			r.Get("/emails", s.v1ListEmails)
			r.Get("/emails/{id}", s.v1GetEmail)
			r.Post("/contacts", s.v1CreateContact)
			r.Get("/audiences", s.v1Audiences)
		})
	})

	r.Get("/t/o/{file}", s.trackOpen)
	r.Get("/t/c/{id}", s.trackClick)
	r.Get("/u/{token}", s.unsubscribe)

	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.db.Ping(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable")
		return
	}
	if err := s.queue.Redis().Ping(r.Context()).Err(); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, "redis_unavailable", "Redis is unavailable")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func contextWithValue(ctx context.Context, key string, value any) context.Context {
	return context.WithValue(ctx, contextKey(key), value)
}
