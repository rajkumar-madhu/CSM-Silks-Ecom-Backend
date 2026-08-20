from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ai", "0002_tryonsession_model_used_default"),
    ]

    operations = [
        migrations.AddField(
            model_name="tryonsession",
            name="customer_photo",
            field=models.URLField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="tryonsession",
            name="result_image",
            field=models.URLField(blank=True, max_length=500),
        ),
    ]
