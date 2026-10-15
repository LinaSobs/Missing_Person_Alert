using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MissingPersonAlert.Api.Models;

namespace MissingPersonAlert.Api.Data;

public sealed class MissingPersonAlertDbContext(DbContextOptions<MissingPersonAlertDbContext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<MissingPersonCase> MissingPersonCases => Set<MissingPersonCase>();
    public DbSet<Sighting> Sightings => Set<Sighting>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<AreaSubscription> AreaSubscriptions => Set<AreaSubscription>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<MissingPersonCase>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.CaseReference).IsUnique();
            entity.HasIndex(x => new { x.ReviewStatus, x.CaseStatus, x.CreatedAt });
            entity.Property(x => x.CaseReference).HasMaxLength(30).IsRequired();
            entity.Property(x => x.PersonName).HasMaxLength(120).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(2000).IsRequired();
            entity.Property(x => x.ClothingDescription).HasMaxLength(300);
            entity.Property(x => x.PublicAreaName).HasMaxLength(150).IsRequired();
            entity.Property(x => x.ContactName).HasMaxLength(120).IsRequired();
            entity.Property(x => x.ContactPhone).HasMaxLength(30).IsRequired();
            entity.Property(x => x.ContactEmail).HasMaxLength(254).IsRequired();
            entity.Property(x => x.Circumstances).HasMaxLength(1500);
            entity.Property(x => x.ReviewStatus).HasMaxLength(30).IsRequired();
            entity.Property(x => x.CaseStatus).HasMaxLength(30).IsRequired();
            entity.Property(x => x.CreatedByUserId).HasMaxLength(450).IsRequired();
            entity.Property(x => x.PhotoStorageKey).HasMaxLength(100);
            entity.Property(x => x.PhotoContentType).HasMaxLength(100);
            entity.Property(x => x.ModerationReason).HasMaxLength(500);
        });

        builder.Entity<Sighting>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.ReviewStatus, x.CreatedAt });
            entity.Property(x => x.Description).HasMaxLength(2000).IsRequired();
            entity.Property(x => x.PublicAreaName).HasMaxLength(150).IsRequired();
            entity.Property(x => x.ContactName).HasMaxLength(120);
            entity.Property(x => x.ContactEmail).HasMaxLength(254);
            entity.Property(x => x.ReviewStatus).HasMaxLength(30).IsRequired();
            entity.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<AuditLog>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ActorUserId).HasMaxLength(450).IsRequired();
            entity.Property(x => x.Action).HasMaxLength(100).IsRequired();
            entity.Property(x => x.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(x => x.EntityId).HasMaxLength(80).IsRequired();
            entity.Property(x => x.Notes).HasMaxLength(1000);
            entity.HasIndex(x => x.CreatedAt);
        });

        builder.Entity<Notification>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.UserId).HasMaxLength(450).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(140).IsRequired();
            entity.Property(x => x.Message).HasMaxLength(500).IsRequired();
            entity.HasIndex(x => new { x.UserId, x.IsRead, x.CreatedAt });
        });

        builder.Entity<AreaSubscription>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.UserId).HasMaxLength(450).IsRequired();
            entity.Property(x => x.AreaName).HasMaxLength(150).IsRequired();
            entity.HasIndex(x => new { x.UserId, x.AreaName }).IsUnique();
        });
    }
}
