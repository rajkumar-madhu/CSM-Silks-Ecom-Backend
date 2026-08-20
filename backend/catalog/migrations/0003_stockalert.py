from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0002_product_assured_product_brand_product_cod_available_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="StockAlert",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("phone", models.CharField(db_index=True, max_length=15)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("notified_at", models.DateTimeField(blank=True, null=True)),
                (
                    "variant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="stock_alerts",
                        to="catalog.productvariant",
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="stockalert",
            constraint=models.UniqueConstraint(fields=("variant", "phone"), name="uniq_stock_alert_variant_phone"),
        ),
    ]
