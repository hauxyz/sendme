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
			r.Post("/workspace/switch", s.switchWorkspace)

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

			r.Route("/admin", func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/overview", s.adminOverview)
				r.Get("/users", s.adminListUsers)
				r.Post("/users", s.adminCreateUser)
				r.Patch("/users/{id}", s.adminUpdateUser)
				r.Post("/users/{id}/password", s.adminResetUserPassword)
				r.Delete("/users/{id}", s.adminDeleteUser)
				r.Get("/workspaces", s.adminListWorkspaces)
				r.Post("/workspaces", s.adminCreateWorkspace)
				r.Patch("/workspaces/{id}", s.adminUpdateWorkspace)
				r.Delete("/workspaces/{id}", s.adminDeleteWorkspace)
				r.Get("/workspaces/{id}/members", s.adminListMembers)
				r.Post("/workspaces/{id}/members", s.adminAddMember)
				r.Delete("/workspaces/{id}/members/{userId}", s.adminRemoveMember)
			})
		})

		r.Route("/v1", func(r chi.Router) {
			r.Use(s.requireAPIKey)
			r.Get("/me", s.v1Me)

			r.Get("/domains", s.v1ListDomains)
			r.Post("/domains", s.v1CreateDomain)
			r.Get("/domains/{id}", s.v1GetDomain)
			r.Put("/domains/{id}/verify", s.v1VerifyDomain)
			r.Delete("/domains/{id}", s.v1DeleteDomain)

			r.Get("/emails", s.v1ListEmails)
			r.Post("/emails", s.v1SendEmail)
			r.Post("/emails/batch", s.v1BatchEmails)
			r.Get("/emails/{id}", s.v1GetEmail)
			r.Patch("/emails/{id}", s.v1UpdateEmail)
			r.Post("/emails/{id}/cancel", s.v1CancelEmail)

			r.Get("/contactBooks", s.v1ListContactBooks)
			r.Post("/contactBooks", s.v1CreateContactBook)
			r.Get("/contactBooks/{id}", s.v1GetContactBook)
			r.Patch("/contactBooks/{id}", s.v1UpdateContactBook)
			r.Delete("/contactBooks/{id}", s.v1DeleteContactBook)
			r.Post("/contactBooks/{id}/contacts/bulk", s.v1BulkAddContacts)
			r.Delete("/contactBooks/{id}/contacts/bulk", s.v1BulkDeleteContacts)
			r.Get("/contactBooks/{id}/contacts", s.v1ListContacts)
			r.Post("/contactBooks/{id}/contacts", s.v1AddContact)
			r.Get("/contactBooks/{id}/contacts/{contactId}", s.v1GetContact)
			r.Patch("/contactBooks/{id}/contacts/{contactId}", s.v1UpdateContact)
			r.Put("/contactBooks/{id}/contacts/{contactId}", s.v1AddContact)
			r.Delete("/contactBooks/{id}/contacts/{contactId}", s.v1DeleteContact)

			r.Get("/campaigns", s.v1ListCampaigns)
			r.Post("/campaigns", s.v1CreateCampaign)
			r.Get("/campaigns/{id}", s.v1GetCampaign)
			r.Delete("/campaigns/{id}", s.v1DeleteCampaign)
			r.Post("/campaigns/{id}/schedule", s.v1ScheduleCampaign)
			r.Post("/campaigns/{id}/pause", s.v1PauseCampaign)
			r.Post("/campaigns/{id}/resume", s.v1ResumeCampaign)

			r.Get("/analytics/email-time-series", s.v1EmailTimeSeries)
			r.Get("/analytics/reputation-metrics", s.v1ReputationMetrics)
		})

		// Public tracking and unsubscribe routes share the /api namespace so
		// every public URL is served from <APP_URL>/api.
		r.Get("/t/o/{file}", s.trackOpen)
		r.Get("/t/c/{id}", s.trackClick)
		r.Get("/u/{token}", s.unsubscribe)
	})

	// Keep the original root paths working for links generated before the API
	// namespace was standardized.
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
