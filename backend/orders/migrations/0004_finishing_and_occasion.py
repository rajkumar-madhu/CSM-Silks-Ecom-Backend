from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0003_coupon"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="finishing_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name="order",
            name="occasion_note",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="blouse_stitching",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="blouse_size",
            field=models.CharField(blank=True, max_length=12),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="fall_pico",
            field=models.BooleanField(default=False),
        ),
    ]
